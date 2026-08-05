import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCAL_DRAFT_CONTEXT_FOLDERS = new Set([
  '.git',
  '.github',
  'ai_notes',
  'findings',
  'errors-reports',
  'CVs_N_photos',
  'node_modules',
  'Output',
  'reports',
  'logs',
  'devonly',
]);

const VARIABLE_CONDITION_IDS = new Set([
  'var',
  'varEq',
  'varNeq',
  'varGt',
  'varGte',
  'varLt',
  'varLte',
  'varIncludes',
  'varLenEq',
  'varLenGt',
  'varLenGte',
  'varLenLt',
  'varLenLte',
]);

const STATUS_TARGET_FIELDS = new Set(['state', 'updatedAt', 'error']);

function parseArgs(rawArgs) {
  const parsed = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith('--')) continue;
    const [rawKey, ...valueParts] = arg.slice(2).split('=');
    parsed[rawKey.trim()] = valueParts.length > 0 ? valueParts.join('=').trim() : 'true';
  }
  return parsed;
}

function splitDelimited(value, delimiter, preserveQuotes = false) {
  const tokens = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const next = value[index + 1];

    if (char === '\\' && next === '"') {
      if (preserveQuotes) current += '"';
      inQuotes = !inQuotes;
      index += 1;
      continue;
    }

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }

      if (preserveQuotes) current += char;
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      tokens.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  tokens.push(current);
  return tokens;
}

function stripOuterQuotes(value) {
  const trimmed = String(value ?? '').trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseConditionCommand(command) {
  const trimmed = String(command ?? '').trim();
  if (!trimmed) return { id: '', rawArgs: [] };
  const colonIdx = trimmed.indexOf(':');
  const rest = colonIdx === -1 ? trimmed : trimmed.slice(colonIdx + 1);
  const commaIdx = rest.indexOf(',');
  if (commaIdx === -1) return { id: rest.trim(), rawArgs: [] };
  const id = rest.slice(0, commaIdx).trim();
  const paramStr = rest.slice(commaIdx + 1);
  const rawArgs = paramStr ? paramStr.split(',').map((entry) => entry.trim()) : [];
  return { id, rawArgs };
}

function parseValueCommand(command) {
  const trimmed = String(command ?? '').trim();
  if (!trimmed) return { id: '', rawArgs: [] };
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return { id: trimmed, rawArgs: [] };
  const id = trimmed.slice(0, colonIdx).trim();
  const paramStr = trimmed.slice(colonIdx + 1);
  const rawArgs = paramStr ? splitDelimited(paramStr, ',', true).map((entry) => entry.trim()) : [];
  return { id, rawArgs };
}

function isObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function objectKeys(value) {
  return isObject(value) ? Object.keys(value) : [];
}

function parts(value) {
  return String(value ?? '').split('.').map((part) => part.trim()).filter(Boolean);
}

function hasPrefix(candidateParts, prefixParts) {
  return prefixParts.every((part, index) => candidateParts[index] === part);
}

function addDataSourceExposure(exposures, dataSource) {
  if (!isObject(dataSource)) return;
  const target = String(dataSource.target ?? '').trim();
  if (!target) return;

  const mapper = isObject(dataSource.mapper) ? dataSource.mapper : {};
  const fieldKeys = objectKeys(mapper.fields);
  const metaKeys = objectKeys(mapper.metaFields);
  const prependKeys = Array.isArray(mapper.prependItems)
    ? mapper.prependItems.flatMap((item) => objectKeys(item))
    : [];

  const existing = exposures.targets.get(target) ?? {
    target,
    targetParts: parts(target),
    dataSourceIds: new Set(),
    strictItemFields: true,
    itemKeys: new Set(),
    metaKeys: new Set(),
  };

  existing.dataSourceIds.add(String(dataSource.id ?? target));
  if (!fieldKeys.length) {
    existing.strictItemFields = false;
  }
  for (const key of [...fieldKeys, ...prependKeys]) existing.itemKeys.add(key);
  for (const key of metaKeys) existing.metaKeys.add(key);
  exposures.targets.set(target, existing);

  const statusTarget = String(dataSource.statusTarget ?? '').trim();
  if (statusTarget) {
    exposures.statusTargets.set(statusTarget, {
      statusTarget,
      targetParts: parts(statusTarget),
      dataSourceIds: new Set([String(dataSource.id ?? target)]),
    });
  }
}

function buildExposureMap(siteConfig) {
  const exposures = {
    targets: new Map(),
    statusTargets: new Map(),
  };

  const dataSources = Array.isArray(siteConfig?.runtime?.dataSources)
    ? siteConfig.runtime.dataSources
    : [];
  for (const dataSource of dataSources) {
    addDataSourceExposure(exposures, dataSource);
  }

  exposures.targetList = [...exposures.targets.values()]
    .sort((left, right) => right.targetParts.length - left.targetParts.length);
  exposures.statusTargetList = [...exposures.statusTargets.values()]
    .sort((left, right) => right.targetParts.length - left.targetParts.length);
  return exposures;
}

function validateVariablePath(variablePath, exposures, reference) {
  const variableParts = parts(variablePath);
  if (!variableParts.length) return undefined;

  for (const statusTarget of exposures.statusTargetList) {
    if (!hasPrefix(variableParts, statusTarget.targetParts)) continue;
    const tail = variableParts.slice(statusTarget.targetParts.length);
    if (tail.length === 0 || STATUS_TARGET_FIELDS.has(tail[0])) return undefined;
    return buildIssue({
      ...reference,
      dataSourceId: [...statusTarget.dataSourceIds].join(','),
      variablePath,
      missingKey: tail[0],
      message: `Condition path '${variablePath}' reads status field '${tail[0]}' that is not exposed by statusTarget '${statusTarget.statusTarget}'.`,
    });
  }

  for (const exposure of exposures.targetList) {
    if (!hasPrefix(variableParts, exposure.targetParts)) continue;
    const tail = variableParts.slice(exposure.targetParts.length);
    if (!tail.length) return undefined;

    if (tail[0] === 'items') {
      if (!exposure.strictItemFields) return undefined;
      const fieldKey = tail[2];
      if (!fieldKey || exposure.itemKeys.has(fieldKey)) return undefined;
      return buildIssue({
        ...reference,
        dataSourceId: [...exposure.dataSourceIds].join(','),
        variablePath,
        missingKey: fieldKey,
        message: `Condition path '${variablePath}' reads item field '${fieldKey}' that is not exposed by mapper.fields for data source '${[...exposure.dataSourceIds].join(',')}'.`,
      });
    }

    if (tail[0] === 'itemsCount' || exposure.metaKeys.has(tail[0])) return undefined;
    return buildIssue({
      ...reference,
      dataSourceId: [...exposure.dataSourceIds].join(','),
      variablePath,
      missingKey: tail[0],
      message: `Condition path '${variablePath}' reads top-level field '${tail[0]}' that is not exposed by mapper.metaFields for data source '${[...exposure.dataSourceIds].join(',')}'.`,
    });
  }

  return undefined;
}

function buildIssue(issue) {
  return {
    source: issue.source,
    filePath: issue.filePath,
    componentId: issue.componentId,
    dataSourceId: issue.dataSourceId,
    variablePath: issue.variablePath,
    missingKey: issue.missingKey,
    message: issue.message,
  };
}

function collectReferencesFromCondition(condition, reference) {
  return String(condition ?? '')
    .split(';')
    .map((command) => command.trim())
    .filter(Boolean)
    .map(parseConditionCommand)
    .filter(({ id, rawArgs }) => VARIABLE_CONDITION_IDS.has(id) && rawArgs[0])
    .map(({ rawArgs }) => ({
      ...reference,
      variablePath: rawArgs[0],
    }));
}

function collectReferencesFromValueInstructions(valueInstructions, reference) {
  const references = [];
  const commands = splitDelimited(String(valueInstructions ?? ''), ';', true)
    .map((command) => command.trim())
    .filter(Boolean);

  for (const command of commands) {
    const { id, rawArgs } = parseValueCommand(command);
    if (id !== 'set') continue;
    const resolverId = String(rawArgs[1] ?? '').trim();
    if (resolverId !== 'when') continue;
    const condition = stripOuterQuotes(rawArgs[2]);
    references.push(...collectReferencesFromCondition(condition, reference));
  }

  return references;
}

function walkConfig(node, visitor, componentId = '') {
  if (Array.isArray(node)) {
    node.forEach((entry) => walkConfig(entry, visitor, componentId));
    return;
  }
  if (!isObject(node)) return;

  const nextComponentId = typeof node.id === 'string' && node.id.trim() ? node.id.trim() : componentId;
  visitor(node, nextComponentId);
  for (const value of Object.values(node)) {
    walkConfig(value, visitor, nextComponentId);
  }
}

function packageFiles(draftPackage) {
  return Array.isArray(draftPackage?.files) ? draftPackage.files : [];
}

function siteConfigFromPackage(draftPackage) {
  return packageFiles(draftPackage).find((file) => file.kind === 'site-config' || String(file.path ?? '').endsWith('/site-config.json'))?.content;
}

export function validateRuntimeDataSourceConditionReferences(draftPackage) {
  const siteConfig = siteConfigFromPackage(draftPackage);
  if (!siteConfig) {
    return { ok: true, issues: [] };
  }

  const exposures = buildExposureMap(siteConfig);
  const issues = [];
  for (const file of packageFiles(draftPackage)) {
    const filePath = String(file.path ?? 'unknown');
    walkConfig(file.content, (node, componentId) => {
      if (typeof node.condition === 'string') {
        const references = collectReferencesFromCondition(node.condition, {
          source: 'condition',
          filePath,
          componentId,
        });
        for (const reference of references) {
          const issue = validateVariablePath(reference.variablePath, exposures, reference);
          if (issue) issues.push(issue);
        }
      }

      if (typeof node.valueInstructions === 'string') {
        const references = collectReferencesFromValueInstructions(node.valueInstructions, {
          source: 'valueInstructions',
          filePath,
          componentId,
        });
        for (const reference of references) {
          const issue = validateVariablePath(reference.variablePath, exposures, reference);
          if (issue) issues.push(issue);
        }
      }
    });
  }

  return { ok: issues.length === 0, issues };
}

export function formatRuntimeDataSourceConditionIssues(issues) {
  return issues
    .map((issue) => {
      const component = issue.componentId ? ` component=${issue.componentId}` : '';
      return `${issue.filePath}${component} ${issue.source}: ${issue.message}`;
    })
    .join('\n');
}

export function assertValidRuntimeDataSourceConditionReferences(draftPackage) {
  const result = validateRuntimeDataSourceConditionReferences(draftPackage);
  if (!result.ok) {
    throw new Error(`Draft runtime data-source condition validation failed:\n${formatRuntimeDataSourceConditionIssues(result.issues)}`);
  }
  return result;
}

async function walkJsonFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (LOCAL_DRAFT_CONTEXT_FOLDERS.has(entry.name)) continue;
      files.push(...(await walkJsonFiles(absolutePath)));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

export async function readDraftPackageForValidation({ draftRoot, domain }) {
  const root = path.resolve(draftRoot);
  if (!existsSync(root)) {
    throw new Error(`Draft root does not exist: ${root}`);
  }
  const files = await walkJsonFiles(root);
  return {
    version: 1,
    domain,
    stage: 'draft',
    files: await Promise.all(files.map(async (filePath) => {
      const relativePath = path.relative(root, filePath).replace(/\\/g, '/');
      return {
        path: relativePath.startsWith(`${domain}/`) ? relativePath : `${domain}/${relativePath}`,
        kind: relativePath === 'site-config.json' || relativePath.endsWith('/site-config.json') ? 'site-config' : 'draft-json',
        content: JSON.parse(await readFile(filePath, 'utf8')),
      };
    })),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const domain = String(args.domain ?? '').trim();
  const draftRoot = String(args['draft-root'] ?? args.draftRoot ?? '').trim();
  if (!domain) throw new Error('Missing required argument --domain');
  if (!draftRoot) throw new Error('Missing required argument --draft-root');

  const draftPackage = await readDraftPackageForValidation({ draftRoot, domain });
  const result = validateRuntimeDataSourceConditionReferences(draftPackage);
  if (!result.ok) {
    console.error(formatRuntimeDataSourceConditionIssues(result.issues));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ ok: true, issueCount: 0 }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
