import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateSchema } from './lib/server-feature-contract-validator.mjs';
import { isLocalOnlyDraftDirectoryName, normalizeDraftPathSegment } from './lib/server-descriptor-kinds.mjs';
import {
  PII_FIELD_NAME_PATTERN,
  PROVIDER_RESOURCE_ID_PATTERN,
  REVIEW_PATTERN_DEFINITIONS,
  SECRET_FIELD_NAME_PATTERN,
  SECRET_PATTERN_DEFINITIONS,
  isOpaqueSecretReference,
} from './lib/sensitive-value-patterns.mjs';

const MAX_DESCRIPTOR_BYTES = 256 * 1024;
const MAX_FINDINGS = 100;
const MAX_NOTIFICATION_SECRET_CHECKS = 20;
const IGNORED_DIRS = new Set([
  '.git', '.github', 'ai_notes', 'findings', 'errors-reports', 'node_modules',
  'output', 'reports', 'logs', 'devonly', '.superpowers', '.agent-coordination',
  '_repos', 'cvs_n_photos', 'tools',
]);
const IGNORED_FILES = new Set(['draft-repo.config.json']);
const SERVER_DESCRIPTOR_FILES = Object.freeze({
  'data-spaces.json': 'data-spaces.schema.json',
  'commerce.json': 'commerce.schema.json',
  'integration-bindings.json': 'integration-bindings.schema.json',
  'notification-policies.json': 'notification-policies.schema.json',
});
const LEGACY_SERVER_FILES = new Set([
  'auth-profile-registry.json',
  'integrations.json',
]);
const INTEGRATION_PROVIDER_CONTRACTS = Object.freeze({
  stripe: Object.freeze({
    adapterVersions: Object.freeze(['v1']),
    capabilities: Object.freeze([
      'connect-onboarding',
      'checkout',
      'one-time-payments',
      'subscriptions',
      'prices',
      'coupons',
      'customer-portal',
    ]),
  }),
  'email.smtp': Object.freeze({
    adapterVersions: Object.freeze(['v1']),
    capabilities: Object.freeze(['send']),
  }),
});
const DATA_SPACE_CAPABILITIES = Object.freeze([
  'data-space:record:read',
  'data-space:record:write',
  'data-space:schema:write',
  'data-space:publish',
]);
const COMMERCE_CAPABILITIES = Object.freeze([
  'commerce:catalog:read',
  'commerce:catalog:write',
  'commerce:inventory:write',
  'commerce:subscription:manage',
  'commerce:fiscal:manage',
]);
const FISCAL_DISCLOSURES = Object.freeze(['manual-invoice-v1']);
const NOTIFICATION_TEMPLATE_BY_TYPE = Object.freeze({
  'payment-succeeded': 'payment-succeeded-v1',
  'payment-failed': 'payment-failed-v1',
});

function parseArgs(rawArgs) {
  const args = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith('--')) continue;
    const [key, ...value] = arg.slice(2).split('=');
    args[key] = value.length > 0 ? value.join('=') : 'true';
  }
  return args;
}

function normalizeDomain(value) {
  const domain = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(domain)) {
    throw new Error('invalid_domain');
  }
  return domain;
}

function normalizeMode(value) {
  const mode = String(value ?? 'dev').trim().toLowerCase();
  if (!['dev', 'test', 'production'].includes(mode)) throw new Error('invalid_mode');
  return mode;
}

function descriptorName(filePath) {
  const normalized = String(filePath ?? '').replace(/\\/g, '/');
  const match = normalized.match(/\/server\/([^/]+)$/);
  return match?.[1];
}

async function loadSchemas(schemaDir = new URL('./schemas/', import.meta.url)) {
  const schemas = new Map();
  for (const [descriptor, schemaFile] of Object.entries(SERVER_DESCRIPTOR_FILES)) {
    schemas.set(descriptor, JSON.parse(await readFile(new URL(schemaFile, schemaDir), 'utf8')));
  }
  return schemas;
}

function makeFinding(code, file, pointer = '$') {
  return {
    code,
    severity: 'blocking',
    file: file ? `server/${path.posix.basename(file)}` : undefined,
    pointer,
  };
}

function addFinding(findings, finding) {
  if (findings.length < MAX_FINDINGS) findings.push(finding);
}

function validateScope({
  scope,
  domain,
  environment,
  expectedTenantId,
  expectedDraftId,
  scopeReference,
  file,
  findings,
}) {
  if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return;
  if (scope.domain !== domain) addFinding(findings, makeFinding('domain_mismatch', file, '$/scope/domain'));
  if (scope.environment !== environment) addFinding(findings, makeFinding('environment_mismatch', file, '$/scope/environment'));
  const tenantId = expectedTenantId ?? scopeReference.tenantId;
  const draftId = expectedDraftId ?? scopeReference.draftId;
  if (tenantId !== undefined && scope.tenantId !== tenantId) {
    addFinding(findings, makeFinding('tenant_scope_mismatch', file, '$/scope/tenantId'));
  }
  if (draftId !== undefined && scope.draftId !== draftId) {
    addFinding(findings, makeFinding('draft_scope_mismatch', file, '$/scope/draftId'));
  }
  scopeReference.tenantId ??= scope.tenantId;
  scopeReference.draftId ??= scope.draftId;
}

function containsPattern(
  value,
  patterns,
  fieldNamePattern,
  depth = 0,
  pathSegments = [],
  allowFieldName,
  allowStringValue,
) {
  if (depth > 32) return true;
  if (typeof value === 'string') {
    if (allowStringValue?.(value, pathSegments)) return false;
    return patterns.some(pattern => pattern.test(value));
  }
  if (Array.isArray(value)) {
    return value.some((item, index) => containsPattern(
      item,
      patterns,
      fieldNamePattern,
      depth + 1,
      [...pathSegments, index],
      allowFieldName,
      allowStringValue,
    ));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => (
      patterns.some(pattern => pattern.test(key))
      || (fieldNamePattern?.test(key) && !allowFieldName?.([...pathSegments, key], item))
      || containsPattern(
        item,
        patterns,
        fieldNamePattern,
        depth + 1,
        [...pathSegments, key],
        allowFieldName,
        allowStringValue,
      )
    ));
  }
  return false;
}

function containsNonJsonValue(value, depth = 0, seen = new Set()) {
  if (depth > 32) return true;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return false;
  if (typeof value === 'number') return !Number.isFinite(value);
  if (Array.isArray(value)) {
    if (seen.has(value)) return true;
    seen.add(value);
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index) || containsNonJsonValue(value[index], depth + 1, seen)) {
        seen.delete(value);
        return true;
      }
    }
    seen.delete(value);
    return false;
  }
  if (value && typeof value === 'object') {
    const prototype = Object.getPrototypeOf(value);
    if ((prototype !== Object.prototype && prototype !== null) || Object.getOwnPropertySymbols(value).length > 0 || seen.has(value)) {
      return true;
    }
    seen.add(value);
    const invalid = Object.values(value).some(item => containsNonJsonValue(item, depth + 1, seen));
    seen.delete(value);
    return invalid;
  }
  return true;
}

function isAllowedLegacySocialIdpSecretReference(pathSegments, value) {
  return pathSegments.length === 5
    && pathSegments[0] === 'profiles'
    && Number.isInteger(pathSegments[1])
    && pathSegments[2] === 'socialIdpSecretRefs'
    && typeof pathSegments[3] === 'string'
    && typeof pathSegments[4] === 'string'
    && typeof value === 'string'
    && isOpaqueSecretReference(value);
}

function addDuplicateIdFindings(items, file, pointer, findings) {
  if (!Array.isArray(items)) return;
  const seen = new Set();
  for (const item of items) {
    const id = typeof item?.id === 'string' ? item.id : undefined;
    if (!id) continue;
    if (seen.has(id)) {
      addFinding(findings, makeFinding('duplicate_id', file, pointer));
      return;
    }
    seen.add(id);
  }
}

function validateDescriptorSemantics(descriptors, legacyDescriptors, findings, environment) {
  const dataSpaces = descriptors.get('data-spaces.json');
  addDuplicateIdFindings(dataSpaces?.spaces, 'data-spaces.json', '$/spaces', findings);
  for (const space of dataSpaces?.spaces ?? []) {
    if (space?.access?.mode === 'auth-profile' && space.access.capabilities?.some(capability => !DATA_SPACE_CAPABILITIES.includes(capability))) {
      addFinding(findings, makeFinding('data_space_capability_not_supported', 'data-spaces.json', '$/spaces/access/capabilities'));
    }
  }

  const integrationBindings = descriptors.get('integration-bindings.json');
  addDuplicateIdFindings(integrationBindings?.bindings, 'integration-bindings.json', '$/bindings', findings);
  const bindings = integrationBindings?.bindings ?? [];
  const expectedMode = environment === 'production' ? 'live' : 'test';
  for (const binding of bindings) {
    const providerContract = INTEGRATION_PROVIDER_CONTRACTS[binding?.provider];
    if (!providerContract) {
      addFinding(findings, makeFinding('provider_not_supported', 'integration-bindings.json', '$/bindings/provider'));
    } else {
      if (!providerContract.adapterVersions.includes(binding?.adapterVersion)) {
        addFinding(findings, makeFinding('adapter_version_not_supported', 'integration-bindings.json', '$/bindings/adapterVersion'));
      }
      if (Array.isArray(binding?.capabilities) && binding.capabilities.some(capability => !providerContract.capabilities.includes(capability))) {
        addFinding(findings, makeFinding('provider_capability_not_supported', 'integration-bindings.json', '$/bindings/capabilities'));
      }
    }
    if (binding?.mode !== expectedMode) {
      addFinding(findings, makeFinding('binding_mode_mismatch', 'integration-bindings.json', '$/bindings/mode'));
    }
    if (binding?.provider === 'stripe' && (!binding.stripe || typeof binding.stripe !== 'object')) {
      addFinding(findings, makeFinding('stripe_settings_required', 'integration-bindings.json', '$/bindings/stripe'));
    }
    if (binding?.provider !== 'stripe' && binding?.stripe !== undefined) {
      addFinding(findings, makeFinding('stripe_settings_not_allowed', 'integration-bindings.json', '$/bindings/stripe'));
    }
  }

  const notificationPolicies = descriptors.get('notification-policies.json');
  addDuplicateIdFindings(notificationPolicies?.policies, 'notification-policies.json', '$/policies', findings);
  const notificationSecretReferences = new Set();
  for (const policy of notificationPolicies?.policies ?? []) {
    addDuplicateIdFindings(policy?.recipientSets, 'notification-policies.json', '$/policies/recipientSets', findings);
    for (const recipientSet of policy?.recipientSets ?? []) {
      addDuplicateIdFindings(recipientSet?.members, 'notification-policies.json', '$/policies/recipientSets/members', findings);
    }
    const notificationTypes = policy?.notificationTypes ?? [];
    const templateIds = policy?.templateIds ?? [];
    if (notificationTypes.some(type => !Object.hasOwn(NOTIFICATION_TEMPLATE_BY_TYPE, type))) {
      addFinding(findings, makeFinding('notification_type_not_supported', 'notification-policies.json', '$/policies/notificationTypes'));
    }
    if (templateIds.some(templateId => !Object.values(NOTIFICATION_TEMPLATE_BY_TYPE).includes(templateId))) {
      addFinding(findings, makeFinding('notification_template_not_supported', 'notification-policies.json', '$/policies/templateIds'));
    }
    const expectedTemplates = notificationTypes
      .map(type => NOTIFICATION_TEMPLATE_BY_TYPE[type])
      .filter(Boolean)
      .sort();
    if (JSON.stringify([...templateIds].sort()) !== JSON.stringify(expectedTemplates)) {
      addFinding(findings, makeFinding('notification_template_mismatch', 'notification-policies.json', '$/policies/templateIds'));
    }
    if (policy?.status === 'active') {
      notificationSecretReferences.add(`smtp:${policy.connectionId}`);
      for (const recipientSet of policy.recipientSets ?? []) {
        for (const member of recipientSet?.members ?? []) {
          notificationSecretReferences.add(`recipient:${recipientSet?.id}:${recipientSet?.version}:${member?.id}`);
        }
      }
      const matchingBinding = bindings.find(binding => (
        binding?.status === 'active'
        && binding?.connectionId === policy?.connectionId
        && binding?.provider === policy?.provider
      ));
      if (!matchingBinding) {
        addFinding(findings, makeFinding('notification_binding_not_found', 'notification-policies.json', '$/policies/connectionId'));
      } else if (!matchingBinding.capabilities?.includes('send')) {
        addFinding(findings, makeFinding('notification_send_capability_required', 'notification-policies.json', '$/policies/connectionId'));
      }
    }
  }
  if (notificationSecretReferences.size > MAX_NOTIFICATION_SECRET_CHECKS) {
    addFinding(findings, makeFinding('notification_secret_limit_exceeded', 'notification-policies.json', '$/policies'));
  }

  const commerce = descriptors.get('commerce.json')?.commerce;
  if (commerce?.adminAccess?.mode === 'auth-profile' && commerce.adminAccess.capabilities?.some(capability => !COMMERCE_CAPABILITIES.includes(capability))) {
    addFinding(findings, makeFinding('commerce_capability_not_supported', 'commerce.json', '$/commerce/adminAccess/capabilities'));
  }
  if (commerce?.status === 'active' && commerce?.payments?.bindingId) {
    const paymentBinding = bindings.find(binding => binding?.id === commerce.payments.bindingId);
    if (!paymentBinding) {
      addFinding(findings, makeFinding('binding_not_found', 'commerce.json', '$/commerce/payments/bindingId'));
    } else if (paymentBinding.status !== 'active') {
      addFinding(findings, makeFinding('binding_inactive', 'commerce.json', '$/commerce/payments/bindingId'));
    } else if (paymentBinding.provider !== 'stripe') {
      addFinding(findings, makeFinding('commerce_payment_provider_not_supported', 'commerce.json', '$/commerce/payments/bindingId'));
    } else {
      const requiredCapabilities = new Set();
      if (commerce.payments.oneTime || commerce.payments.subscriptions) requiredCapabilities.add('checkout');
      if (commerce.payments.oneTime) requiredCapabilities.add('one-time-payments');
      if (commerce.payments.subscriptions) requiredCapabilities.add('subscriptions');
      if (commerce.payments.editablePrices) requiredCapabilities.add('prices');
      if (commerce.payments.coupons) requiredCapabilities.add('coupons');
      if ([...requiredCapabilities].some(capability => !paymentBinding.capabilities?.includes(capability))) {
        addFinding(findings, makeFinding('commerce_provider_capability_required', 'commerce.json', '$/commerce/payments'));
      }
    }
  }
  if (commerce?.sellableTypes?.includes('physical') && commerce?.inventory?.enabled !== true) {
    addFinding(findings, makeFinding('physical_inventory_required', 'commerce.json', '$/commerce/inventory'));
  }
  if (commerce?.sellableTypes?.includes('physical') && commerce?.shipping?.enabled !== true) {
    addFinding(findings, makeFinding('physical_shipping_required', 'commerce.json', '$/commerce/shipping'));
  }
  if (commerce?.sellableTypes?.includes('subscription') && commerce?.payments?.subscriptions !== true) {
    addFinding(findings, makeFinding('subscription_payments_required', 'commerce.json', '$/commerce/payments/subscriptions'));
  }
  if (commerce?.fiscal?.enabled === true && !FISCAL_DISCLOSURES.includes(commerce.fiscal.disclosureId)) {
    addFinding(findings, makeFinding('unknown_fiscal_disclosure', 'commerce.json', '$/commerce/fiscal/disclosureId'));
  }
  if (commerce?.fiscal?.enabled === true && (
    commerce?.adminAccess?.mode !== 'auth-profile'
    || !commerce.adminAccess.capabilities?.includes('commerce:fiscal:manage')
  )) {
    addFinding(findings, makeFinding('fiscal_admin_access_required', 'commerce.json', '$/commerce/adminAccess'));
  }
  const notificationPolicyIds = new Set((notificationPolicies?.policies ?? []).map(policy => policy?.id).filter(Boolean));
  for (const policyId of commerce?.notificationPolicyIds ?? []) {
    if (!notificationPolicyIds.has(policyId)) {
      addFinding(findings, makeFinding('notification_policy_not_found', 'commerce.json', '$/commerce/notificationPolicyIds'));
    }
  }

  const authProfileReferences = [];
  for (const space of dataSpaces?.spaces ?? []) {
    if (space?.access?.mode === 'auth-profile') {
      authProfileReferences.push({
        id: space.access.authProfileId,
        scope: dataSpaces.scope,
        file: 'data-spaces.json',
        pointer: '$/spaces/access/authProfileId',
      });
    }
  }
  if (commerce?.adminAccess?.mode === 'auth-profile') {
    authProfileReferences.push({
      id: commerce.adminAccess.authProfileId,
      scope: descriptors.get('commerce.json')?.scope,
      file: 'commerce.json',
      pointer: '$/commerce/adminAccess/authProfileId',
    });
  }
  if (authProfileReferences.length > 0) {
    const authRegistry = legacyDescriptors.get('auth-profile-registry.json');
    if (!authRegistry) {
      addFinding(findings, makeFinding('auth_profile_registry_required', authProfileReferences[0].file, authProfileReferences[0].pointer));
    } else {
      addDuplicateIdFindings(
        (authRegistry.profiles ?? []).map(profile => ({ id: profile?.authProfileId })),
        'auth-profile-registry.json',
        '$/profiles',
        findings,
      );
      const profiles = new Map((authRegistry.profiles ?? []).map(profile => [profile?.authProfileId, profile]));
      for (const reference of authProfileReferences) {
        const profile = profiles.get(reference.id);
        if (!profile) {
          addFinding(findings, makeFinding('auth_profile_not_found', reference.file, reference.pointer));
          continue;
        }
        if (profile.status !== 'active') {
          addFinding(findings, makeFinding('auth_profile_inactive', reference.file, reference.pointer));
        }
        if (profile.tenantId !== reference.scope?.tenantId || (profile.domain !== undefined && profile.domain !== reference.scope?.domain)) {
          addFinding(findings, makeFinding('auth_profile_scope_mismatch', reference.file, reference.pointer));
        }
      }
    }
  }
}

function validateProductionSemantics(descriptors, findings) {
  const integrationBindings = descriptors.get('integration-bindings.json')?.bindings ?? [];
  for (const binding of integrationBindings) {
    if (binding?.status === 'active' && binding?.mode !== 'live') {
      addFinding(findings, makeFinding('live_binding_required', 'integration-bindings.json', '$/bindings/mode'));
    }
    if (binding?.provider === 'stripe' && binding?.status === 'active') {
      addFinding(findings, makeFinding('stripe_tax_live_gate_pending', 'integration-bindings.json', '$/bindings/stripe/taxMode'));
      if (binding?.stripe?.taxMode === 'unconfigured' || !binding?.stripe?.taxApprovalId) {
        addFinding(findings, makeFinding('tax_configuration_unapproved', 'integration-bindings.json', '$/bindings/stripe/taxMode'));
      }
      if (binding?.stripe?.platformFeeMode !== 'disabled') {
        addFinding(findings, makeFinding('platform_fee_not_supported', 'integration-bindings.json', '$/bindings/stripe/platformFeeMode'));
      }
    }
  }

  const fiscal = descriptors.get('commerce.json')?.commerce?.fiscal;
  if (fiscal?.enabled === true && !fiscal?.accountantApprovalId) {
    addFinding(findings, makeFinding('fiscal_approval_required', 'commerce.json', '$/commerce/fiscal'));
  }
  if (fiscal?.enabled === true) {
    addFinding(findings, makeFinding('fiscal_live_gate_pending', 'commerce.json', '$/commerce/fiscal'));
  }

  for (const policy of descriptors.get('notification-policies.json')?.policies ?? []) {
    if (policy?.status === 'active' && !policy?.transportApprovalId) {
      addFinding(findings, makeFinding('notification_transport_approval_required', 'notification-policies.json', '$/policies'));
    }
    if (policy?.status === 'active') {
      addFinding(findings, makeFinding('notification_transport_live_gate_pending', 'notification-policies.json', '$/policies'));
    }
  }
}

async function validateDraftFeatureReadiness({
  domain,
  environment,
  mode,
  expectedTenantId,
  expectedDraftId,
  files,
  schemaDir,
} = {}) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedMode = normalizeMode(mode ?? environment);
  const normalizedEnvironment = String(environment ?? (normalizedMode === 'dev' ? 'test' : normalizedMode)).trim().toLowerCase();
  if (!['test', 'production'].includes(normalizedEnvironment)) throw new Error('invalid_environment');
  const expectedEnvironment = normalizedMode === 'dev' ? 'test' : normalizedMode;
  if (normalizedEnvironment !== expectedEnvironment) throw new Error('mode_environment_mismatch');
  if (!Array.isArray(files)) throw new Error('invalid_files');

  const schemas = await loadSchemas(schemaDir);
  const findings = [];
  const descriptors = new Map();
  const legacyDescriptors = new Map();
  const seenPaths = new Set();
  const scopeReference = {};

  for (const file of files) {
    const normalizedPath = String(file?.path ?? '').replace(/\\/g, '/');
    if (!normalizedPath || seenPaths.has(normalizedPath)) {
      addFinding(findings, makeFinding('duplicate_path'));
      continue;
    }
    seenPaths.add(normalizedPath);
    const pathSegments = normalizedPath.split('/');
    let decodedPathSegments;
    try {
      decodedPathSegments = pathSegments.map(normalizeDraftPathSegment);
    } catch {
      addFinding(findings, makeFinding('invalid_server_descriptor_path'));
      continue;
    }
    const serverSegmentIndexes = decodedPathSegments
      .map((segment, index) => (segment.toLowerCase() === 'server' ? index : -1))
      .filter(index => index >= 0);
    if (serverSegmentIndexes.length > 0) {
      const isCanonicalServerPath = pathSegments.length === 3
        && pathSegments[0] === normalizedDomain
        && pathSegments[1] === 'server';
      if (!isCanonicalServerPath) {
        addFinding(findings, makeFinding('invalid_server_descriptor_path'));
        continue;
      }
    }
    const name = descriptorName(normalizedPath);
    const allowLegacySecretReference = name === 'auth-profile-registry.json'
      ? isAllowedLegacySocialIdpSecretReference
      : undefined;
    if (containsPattern(
      file.content,
      SECRET_PATTERN_DEFINITIONS.map(rule => rule.regex),
      SECRET_FIELD_NAME_PATTERN,
      0,
      [],
      allowLegacySecretReference,
      isOpaqueSecretReference,
    )) {
      addFinding(findings, makeFinding('secret_value_forbidden', name));
    }
    if (!name) continue;
    if (containsNonJsonValue(file.content)) {
      addFinding(findings, makeFinding('non_json_value_forbidden', name));
      continue;
    }
    if (containsPattern(file.content, REVIEW_PATTERN_DEFINITIONS.map(rule => rule.regex), PII_FIELD_NAME_PATTERN)) {
      addFinding(findings, makeFinding('pii_value_forbidden', name));
    }
    if (containsPattern(file.content, [PROVIDER_RESOURCE_ID_PATTERN])) {
      addFinding(findings, makeFinding('provider_resource_id_forbidden', name));
    }
    const serialized = JSON.stringify(file.content) ?? '';
    if (Buffer.byteLength(serialized, 'utf8') > MAX_DESCRIPTOR_BYTES) {
      addFinding(findings, makeFinding('descriptor_too_large', name));
      continue;
    }
    if (!Object.hasOwn(SERVER_DESCRIPTOR_FILES, name)) {
      if (LEGACY_SERVER_FILES.has(name)) legacyDescriptors.set(name, file.content);
      else addFinding(findings, makeFinding('unknown_server_descriptor'));
      continue;
    }
    descriptors.set(name, file.content);
    const schemaErrors = validateSchema(schemas.get(name), file.content);
    for (const error of schemaErrors) {
      addFinding(findings, makeFinding(`schema_${error.code}`, name, error.pointer));
    }
    validateScope({
      scope: file.content?.scope,
      domain: normalizedDomain,
      environment: normalizedEnvironment,
      expectedTenantId,
      expectedDraftId,
      scopeReference,
      file: name,
      findings,
    });
  }

  validateDescriptorSemantics(descriptors, legacyDescriptors, findings, normalizedEnvironment);
  if (normalizedMode === 'production') validateProductionSemantics(descriptors, findings);

  const blockingCount = findings.filter(finding => finding.severity === 'blocking').length;
  return {
    ok: blockingCount === 0,
    mode: normalizedMode,
    domain: normalizedDomain,
    environment: normalizedEnvironment,
    fileCount: files.length,
    featureFileCount: descriptors.size,
    blockingCount,
    warningCount: 0,
    findings,
  };
}

async function collectJsonFiles(root, domain, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name.toLowerCase()) || isLocalOnlyDraftDirectoryName(entry.name)) continue;
      files.push(...await collectJsonFiles(root, domain, path.join(current, entry.name)));
      continue;
    }
    if (!entry.isFile() || IGNORED_FILES.has(entry.name) || !entry.name.endsWith('.json')) continue;
    const absolutePath = path.join(current, entry.name);
    const fromRoot = path.relative(root, absolutePath).replace(/\\/g, '/');
    const relativePath = fromRoot.startsWith(`${domain}/`) ? fromRoot : `${domain}/${fromRoot}`;
    files.push({ path: relativePath, content: JSON.parse(await readFile(absolutePath, 'utf8')) });
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = normalizeMode(args.mode ?? args.environment ?? 'dev');
  const environment = mode === 'dev' ? 'test' : mode;
  const domain = normalizeDomain(args.domain ?? process.env.DRAFT_DOMAIN);
  const draftRoot = path.resolve(args['draft-root'] ?? process.env.DRAFT_ROOT ?? '.');
  if (!existsSync(draftRoot)) throw new Error('draft_root_missing');
  const files = await collectJsonFiles(draftRoot, domain);
  const report = await validateDraftFeatureReadiness({ domain, environment, mode, files });
  console.log(JSON.stringify(report, null, 2));
  if (mode !== 'dev' && !report.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(() => {
    console.log(JSON.stringify({
      ok: false,
      blockingCount: 1,
      warningCount: 0,
      findings: [{ code: 'readiness_internal_error', severity: 'blocking' }],
    }, null, 2));
    process.exitCode = 1;
  });
}

export {
  collectJsonFiles,
  INTEGRATION_PROVIDER_CONTRACTS,
  COMMERCE_CAPABILITIES,
  DATA_SPACE_CAPABILITIES,
  FISCAL_DISCLOSURES,
  LEGACY_SERVER_FILES,
  MAX_DESCRIPTOR_BYTES,
  MAX_NOTIFICATION_SECRET_CHECKS,
  NOTIFICATION_TEMPLATE_BY_TYPE,
  normalizeDomain,
  normalizeMode,
  SERVER_DESCRIPTOR_FILES,
  validateDraftFeatureReadiness,
};
