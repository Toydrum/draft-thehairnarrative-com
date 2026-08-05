const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_ERRORS = 64;

const SUPPORTED_SCHEMA_KEYWORDS = new Set([
  '$schema',
  '$id',
  '$ref',
  'title',
  'description',
  'definitions',
  'type',
  'required',
  'properties',
  'additionalProperties',
  'propertyNames',
  'minProperties',
  'maxProperties',
  'items',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minLength',
  'maxLength',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'enum',
  'const',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'if',
  'then',
  'else',
]);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function childSchemas(schema) {
  const children = [];
  for (const key of ['definitions', 'properties']) {
    if (isObject(schema[key])) children.push(...Object.values(schema[key]));
  }
  for (const key of ['items', 'additionalProperties', 'propertyNames', 'not', 'if', 'then', 'else']) {
    if (isObject(schema[key])) children.push(schema[key]);
  }
  for (const key of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(schema[key])) children.push(...schema[key]);
  }
  return children;
}

function assertSupportedSchema(schema, { maxDepth = DEFAULT_MAX_DEPTH } = {}) {
  const jsonTypes = new Set(['null', 'array', 'object', 'integer', 'number', 'boolean', 'string']);
  const invalidShape = () => { throw new Error('invalid_schema_keyword_shape'); };
  const visit = (node, depth) => {
    if (!isObject(node) || depth > maxDepth) {
      throw new Error(depth > maxDepth ? 'schema_depth_exceeded' : 'invalid_schema_node');
    }
    for (const key of Object.keys(node)) {
      if (!SUPPORTED_SCHEMA_KEYWORDS.has(key)) {
        throw new Error(`unsupported_schema_keyword:${key}`);
      }
    }

    for (const key of ['$schema', '$id', 'title', 'description']) {
      if (Object.hasOwn(node, key) && typeof node[key] !== 'string') invalidShape();
    }
    if (Object.hasOwn(node, '$ref')) {
      if (typeof node.$ref !== 'string' || !node.$ref.startsWith('#/')) invalidShape();
      resolveSchemaRef(schema, node.$ref);
    }
    if (Object.hasOwn(node, 'type')) {
      const declared = node.type;
      if (typeof declared === 'string') {
        if (!jsonTypes.has(declared)) invalidShape();
      } else if (
        !Array.isArray(declared)
        || declared.length === 0
        || declared.some(type => typeof type !== 'string' || !jsonTypes.has(type))
        || new Set(declared).size !== declared.length
      ) {
        invalidShape();
      }
    }
    for (const key of ['definitions', 'properties']) {
      if (Object.hasOwn(node, key) && (
        !isObject(node[key])
        || Object.entries(node[key]).some(([name, child]) => typeof name !== 'string' || !isObject(child))
      )) invalidShape();
    }
    if (Object.hasOwn(node, 'required') && (
      !Array.isArray(node.required)
      || node.required.some(item => typeof item !== 'string')
      || new Set(node.required).size !== node.required.length
    )) invalidShape();
    for (const key of ['items', 'propertyNames', 'not', 'if', 'then', 'else']) {
      if (Object.hasOwn(node, key) && !isObject(node[key])) invalidShape();
    }
    if (Object.hasOwn(node, 'additionalProperties')
      && typeof node.additionalProperties !== 'boolean'
      && !isObject(node.additionalProperties)) invalidShape();
    for (const key of ['anyOf', 'oneOf', 'allOf']) {
      if (Object.hasOwn(node, key) && (
        !Array.isArray(node[key])
        || node[key].length === 0
        || node[key].some(child => !isObject(child))
      )) invalidShape();
    }
    for (const key of ['minProperties', 'maxProperties', 'minItems', 'maxItems', 'minLength', 'maxLength']) {
      if (Object.hasOwn(node, key) && (!Number.isInteger(node[key]) || node[key] < 0)) invalidShape();
    }
    if (Object.hasOwn(node, 'uniqueItems') && typeof node.uniqueItems !== 'boolean') invalidShape();
    if (Object.hasOwn(node, 'pattern') && typeof node.pattern !== 'string') invalidShape();
    for (const key of ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum']) {
      if (Object.hasOwn(node, key) && (typeof node[key] !== 'number' || !Number.isFinite(node[key]))) invalidShape();
    }
    if (Object.hasOwn(node, 'enum') && (
      !Array.isArray(node.enum)
      || node.enum.length === 0
      || new Set(node.enum.map(canonicalJson)).size !== node.enum.length
    )) invalidShape();

    if (typeof node.pattern === 'string') {
      try {
        new RegExp(node.pattern, 'u');
      } catch {
        throw new Error('invalid_schema_pattern');
      }
    }
    for (const child of childSchemas(node)) visit(child, depth + 1);
  };
  visit(schema, 0);
}

function decodePointerPart(value) {
  return value.replace(/~1/g, '/').replace(/~0/g, '~');
}

function resolveSchemaRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error('unsupported_schema_ref');
  }
  const resolved = ref
    .slice(2)
    .split('/')
    .map(decodePointerPart)
    .reduce((current, part) => (isObject(current) ? current[part] : undefined), root);
  if (!isObject(resolved)) throw new Error('unresolved_schema_ref');
  return resolved;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function typeMatches(type, value) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return isObject(value);
  if (type === 'integer') return Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}

function validateSchema(schema, value, options = {}) {
  assertSupportedSchema(schema, options);
  const root = schema;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxErrors = options.maxErrors ?? DEFAULT_MAX_ERRORS;
  const errors = [];

  const add = (code, pointer) => {
    if (errors.length < maxErrors) errors.push({ code, pointer });
  };

  const inspect = (node, currentValue, pointer, depth) => {
    if (errors.length >= maxErrors) return;
    if (depth > maxDepth) {
      add('instance_depth_exceeded', pointer);
      return;
    }
    if (node.$ref) {
      inspect(resolveSchemaRef(root, node.$ref), currentValue, pointer, depth + 1);
      return;
    }

    if (node.const !== undefined && !Object.is(currentValue, node.const)) add('const_mismatch', pointer);
    if (Array.isArray(node.enum) && !node.enum.some(item => Object.is(item, currentValue))) add('enum_mismatch', pointer);

    const declaredTypes = Array.isArray(node.type) ? node.type : node.type ? [node.type] : [];
    if (declaredTypes.length > 0 && !declaredTypes.some(type => typeMatches(type, currentValue))) {
      add(declaredTypes.includes('integer') ? 'integer_required' : 'type_mismatch', pointer);
      return;
    }

    if (Array.isArray(node.anyOf)) {
      const matches = node.anyOf.some(candidate => validateBranch(candidate, currentValue, pointer, depth + 1).length === 0);
      if (!matches) add('any_of', pointer);
    }
    if (Array.isArray(node.oneOf)) {
      const matches = node.oneOf.filter(candidate => validateBranch(candidate, currentValue, pointer, depth + 1).length === 0).length;
      if (matches !== 1) add('one_of', pointer);
    }
    if (Array.isArray(node.allOf)) {
      for (const candidate of node.allOf) inspect(candidate, currentValue, pointer, depth + 1);
    }
    if (node.not && validateBranch(node.not, currentValue, pointer, depth + 1).length === 0) add('not_allowed', pointer);
    if (node.if) {
      const conditionMatches = validateBranch(node.if, currentValue, pointer, depth + 1).length === 0;
      if (conditionMatches && node.then) inspect(node.then, currentValue, pointer, depth + 1);
      if (!conditionMatches && node.else) inspect(node.else, currentValue, pointer, depth + 1);
    }

    if (typeof currentValue === 'string') {
      if (node.minLength !== undefined && currentValue.length < node.minLength) add('string_min_length', pointer);
      if (node.maxLength !== undefined && currentValue.length > node.maxLength) add('string_max_length', pointer);
      if (node.pattern && !new RegExp(node.pattern, 'u').test(currentValue)) add('string_pattern', pointer);
    }

    if (typeof currentValue === 'number' && Number.isFinite(currentValue)) {
      if (node.minimum !== undefined && currentValue < node.minimum) add('number_minimum', pointer);
      if (node.maximum !== undefined && currentValue > node.maximum) add('number_maximum', pointer);
      if (node.exclusiveMinimum !== undefined && currentValue <= node.exclusiveMinimum) add('number_exclusive_minimum', pointer);
      if (node.exclusiveMaximum !== undefined && currentValue >= node.exclusiveMaximum) add('number_exclusive_maximum', pointer);
    }

    if (Array.isArray(currentValue)) {
      if (node.minItems !== undefined && currentValue.length < node.minItems) add('array_min_items', pointer);
      if (node.maxItems !== undefined && currentValue.length > node.maxItems) add('array_max_items', pointer);
      if (node.uniqueItems) {
        const seen = new Set();
        for (const item of currentValue) {
          const canonical = canonicalJson(item);
          if (seen.has(canonical)) {
            add('array_unique', pointer);
            break;
          }
          seen.add(canonical);
        }
      }
      if (isObject(node.items)) {
        currentValue.forEach((item, index) => inspect(node.items, item, `${pointer}/${index}`, depth + 1));
      }
    }

    if (isObject(currentValue)) {
      const keys = Object.keys(currentValue);
      if (node.minProperties !== undefined && keys.length < node.minProperties) add('object_min_properties', pointer);
      if (node.maxProperties !== undefined && keys.length > node.maxProperties) add('object_max_properties', pointer);
      for (const requiredKey of node.required ?? []) {
        if (!Object.hasOwn(currentValue, requiredKey)) add('required', pointer);
      }
      const properties = isObject(node.properties) ? node.properties : {};
      for (const key of keys) {
        if (node.propertyNames) inspect(node.propertyNames, key, pointer, depth + 1);
        if (isObject(properties[key])) {
          inspect(properties[key], currentValue[key], `${pointer}/${key}`, depth + 1);
        } else if (node.additionalProperties === false) {
          add('property_not_allowed', pointer);
        } else if (isObject(node.additionalProperties)) {
          inspect(node.additionalProperties, currentValue[key], pointer, depth + 1);
        }
      }
    }
  };

  const validateBranch = (branch, branchValue, pointer, depth) => {
    const branchErrors = [];
    const originalErrors = errors;
    const originalAdd = add;
    void originalErrors;
    void originalAdd;
    const before = errors.length;
    inspect(branch, branchValue, pointer, depth);
    branchErrors.push(...errors.splice(before));
    return branchErrors;
  };

  inspect(schema, value, '$', 0);
  return errors;
}

export {
  assertSupportedSchema,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_ERRORS,
  SUPPORTED_SCHEMA_KEYWORDS,
  validateSchema,
};
