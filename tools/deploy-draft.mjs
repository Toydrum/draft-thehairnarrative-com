import { createHash, createHmac } from 'node:crypto';
import { existsSync } from 'node:fs';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateDraftFeatureReadiness } from './draft-feature-readiness.mjs';
import { inferServerDescriptorKind, isLocalOnlyDraftDirectoryName } from './lib/server-descriptor-kinds.mjs';
import { assertValidRuntimeDataSourceConditionReferences } from './runtime-data-source-condition-guard.mjs';

const IGNORED_DIRS = new Set([
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

const IGNORED_FILE_NAMES = new Set(['.DS_Store', 'draft-repo.config.json', 'package.json', 'package-lock.json']);
const JSON_SUFFIX = '.json';
const SHA_PATTERN = /^[a-f0-9]{40}$/;
const RUN_ID_PATTERN = /^[1-9][0-9]{0,19}$/;
const RUN_ATTEMPT_PATTERN = /^[1-9][0-9]{0,9}$/;
const VERSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ROOT_JSON_FILES = new Set(['site-config.json', 'components.json', 'variables.json', 'angora-combos.json']);
const PAGE_JSON_FILES = new Set(['page-config.json', 'components.json', 'variables.json', 'angora-combos.json']);

function parseArgs(rawArgs) {
  const args = {};
  for (const arg of rawArgs) {
    if (!arg.startsWith('--')) continue;
    const [rawKey, ...valueParts] = arg.slice(2).split('=');
    args[rawKey.trim()] = valueParts.length > 0 ? valueParts.join('=').trim() : 'true';
  }
  return args;
}

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${name} is required`);
  }
  return normalized;
}

function normalizeDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .split(':', 1)[0]
    .replace(/^\/+|\/+$/g, '');
}

function normalizeEnvironment(value) {
  const environment = String(value ?? 'production').trim().toLowerCase();
  if (['prod', 'live', 'main'].includes(environment)) return 'production';
  if (['testing', 'stage', 'staging'].includes(environment)) return 'test';
  if (['production', 'test'].includes(environment)) return environment;
  throw new Error(`Invalid environment '${value}'. Expected production or test.`);
}

function normalizeBoolean(value) {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function sanitizeVersionSegment(value) {
  return String(value ?? '')
    .trim()
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'manual';
}

function inferKind(relativePath) {
  const parts = relativePath.split('/');
  const serverKind = inferServerDescriptorKind(parts[0], relativePath);
  if (serverKind) return serverKind;
  if (relativePath.endsWith('site-config.json')) return 'site-config';
  if (relativePath.endsWith('/components.json') && relativePath.split('/').length === 2) return 'shared-components';
  if (relativePath.endsWith('/variables.json') && relativePath.split('/').length === 2) return 'shared-variables';
  if (relativePath.endsWith('/angora-combos.json') && relativePath.split('/').length === 2) return 'shared-angora-combos';
  if (relativePath.includes('/i18n/') && relativePath.endsWith('.json') && relativePath.split('/').length === 3) {
    return 'shared-i18n';
  }
  if (relativePath.endsWith('/page-config.json')) return 'page-config';
  if (relativePath.endsWith('/components.json')) return 'page-components';
  if (relativePath.endsWith('/variables.json')) return 'variables';
  if (relativePath.endsWith('/angora-combos.json')) return 'angora-combos';
  if (relativePath.includes('/i18n/') && relativePath.endsWith('.json')) return 'i18n';
  return 'page-components';
}

function inferPageId(domain, relativePath) {
  const parts = relativePath.split('/');
  if (parts.length < 3 || parts[0] !== domain || parts[1] === 'i18n' || parts[1] === 'server') return undefined;
  return parts[1];
}

function inferLang(relativePath) {
  if (!relativePath.includes('/i18n/')) return undefined;
  const fileName = relativePath.split('/').at(-1) ?? '';
  return fileName.endsWith(JSON_SUFFIX) ? fileName.slice(0, -JSON_SUFFIX.length) : undefined;
}

function assertAllowedDraftJsonPath(domain, relativePath) {
  const parts = relativePath.split('/');
  if (
    parts[0] !== domain
    || parts.some(segment => (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.includes('%')
      || segment.includes('\\')
      || /[\u0000-\u001f\u007f]/.test(segment)
    ))
  ) {
    throw new Error('unknown_draft_json_path');
  }
  const fileName = parts.at(-1);
  const allowed = (parts.length === 2 && ROOT_JSON_FILES.has(fileName))
    || (parts.length === 3 && parts[1] === 'i18n' && fileName.endsWith(JSON_SUFFIX) && fileName !== JSON_SUFFIX)
    || (parts.length === 3 && parts[1] === 'server')
    || (parts.length === 3 && PAGE_JSON_FILES.has(fileName))
    || (
      parts.length === 4
      && parts[1] !== 'i18n'
      && parts[1].toLowerCase() !== 'server'
      && parts[2] === 'i18n'
      && fileName.endsWith(JSON_SUFFIX)
      && fileName !== JSON_SUFFIX
    );
  if (!allowed) throw new Error('unknown_draft_json_path');
}

async function collectJsonFiles(root, domain, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.has(entry.name) || isLocalOnlyDraftDirectoryName(entry.name)) continue;
      files.push(...(await collectJsonFiles(root, domain, path.join(current, entry.name))));
      continue;
    }

    if (!entry.isFile() || IGNORED_FILE_NAMES.has(entry.name) || !entry.name.endsWith(JSON_SUFFIX)) continue;
    const absolutePath = path.join(current, entry.name);
    const fromRoot = path.relative(root, absolutePath).replace(/\\/g, '/');
    const relativePath = fromRoot.startsWith(`${domain}/`) ? fromRoot : `${domain}/${fromRoot}`;
    assertAllowedDraftJsonPath(domain, relativePath);
    const content = JSON.parse(await readFile(absolutePath, 'utf8'));
    files.push({
      path: relativePath,
      kind: inferKind(relativePath),
      pageId: inferPageId(domain, relativePath),
      lang: inferLang(relativePath),
      content,
    });
  }

  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function resolvePlanVersionId({ environment, targetSha, versionId, runId, runAttempt }) {
  const explicitVersionId = String(versionId ?? '').trim();
  if (explicitVersionId) {
    if (!VERSION_ID_PATTERN.test(explicitVersionId)) throw new Error('invalid_version_id');
    return explicitVersionId;
  }
  if (!RUN_ID_PATTERN.test(runId ?? '') || !RUN_ATTEMPT_PATTERN.test(runAttempt ?? '')) {
    throw new Error('plan_version_context_required');
  }
  const derivedVersionId = `${environment}-${targetSha}-${runId}-${runAttempt}`;
  if (!VERSION_ID_PATTERN.test(derivedVersionId)) throw new Error('invalid_version_id');
  return derivedVersionId;
}

function buildDeploymentPlan({ domain, environment, targetSha, versionId, runId, runAttempt, files }) {
  if (!SHA_PATTERN.test(targetSha ?? '')) throw new Error('invalid_target_sha');
  return {
    schemaVersion: 1,
    targetSha,
    domain,
    environment,
    versionId: resolvePlanVersionId({ environment, targetSha, versionId, runId, runAttempt }),
    actions: ['upsertDraft', 'publishDraft'],
    files,
  };
}

function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

async function resolveSafePlanOutputPath(root, requestedPath) {
  const rawPath = String(requestedPath ?? '').trim();
  if (
    !rawPath
    || path.isAbsolute(rawPath)
    || path.posix.isAbsolute(rawPath)
    || path.win32.isAbsolute(rawPath)
    || /[\u0000-\u001f\u007f]/.test(rawPath)
  ) {
    throw new Error('unsafe_plan_output_path');
  }
  const segments = rawPath.split(/[\\/]/);
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error('unsafe_plan_output_path');
  }

  const rootPath = path.resolve(root);
  const rootRealPath = await realpath(rootPath);
  const outputPath = path.resolve(rootPath, ...segments);
  if (!isPathInside(rootPath, outputPath) || outputPath === rootPath) {
    throw new Error('unsafe_plan_output_path');
  }

  let currentPath = rootPath;
  for (let index = 0; index < segments.length; index += 1) {
    currentPath = path.join(currentPath, segments[index]);
    let stats;
    try {
      stats = await lstat(currentPath);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      if (index !== segments.length - 1) throw new Error('plan_output_parent_missing');
      continue;
    }
    if (stats.isSymbolicLink()) throw new Error('unsafe_plan_output_path');
    if (index !== segments.length - 1) {
      if (!stats.isDirectory()) throw new Error('unsafe_plan_output_path');
    } else {
      throw new Error('plan_output_target_exists');
    }
  }

  const parentRealPath = await realpath(path.dirname(outputPath));
  if (!isPathInside(rootRealPath, parentRealPath)) throw new Error('unsafe_plan_output_path');
  return outputPath;
}

function hash(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key, value, encoding) {
  return createHmac('sha256', key).update(value, 'utf8').digest(encoding);
}

function getSigningKey(secretAccessKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

async function signedPostJson({ endpoint, region, payload }) {
  const accessKeyId = required(process.env.AWS_ACCESS_KEY_ID, 'AWS_ACCESS_KEY_ID');
  const secretAccessKey = required(process.env.AWS_SECRET_ACCESS_KEY, 'AWS_SECRET_ACCESS_KEY');
  const sessionToken = process.env.AWS_SESSION_TOKEN;
  const url = new URL(endpoint);
  const service = url.hostname.includes('.lambda-url.') ? 'lambda' : 'execute-api';
  const body = JSON.stringify(payload);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const canonicalUri = url.pathname || '/';
  const canonicalQueryString = '';
  const headers = {
    'content-type': 'application/json',
    host: url.host,
    'x-amz-content-sha256': hash(body),
    'x-amz-date': amzDate,
  };
  if (sessionToken) {
    headers['x-amz-security-token'] = sessionToken;
  }

  const signedHeaders = Object.keys(headers).sort().join(';');
  const canonicalHeaders = Object.keys(headers)
    .sort()
    .map(name => `${name}:${headers[name]}\n`)
    .join('');
  const payloadHash = headers['x-amz-content-sha256'];
  const canonicalRequest = ['POST', canonicalUri, canonicalQueryString, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credentialScope, hash(canonicalRequest)].join('\n');
  const signature = hmac(getSigningKey(secretAccessKey, dateStamp, region, service), stringToSign, 'hex');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...headers,
      Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body,
  });
  const text = await response.text();
  let parsed = {};
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text.slice(0, 500) };
    }
  }
  if (!response.ok || parsed.ok === false) {
    const responseType = response.headers.get('x-amzn-errortype') || response.headers.get('x-amzn-errorType');
    const message = parsed.error || parsed.message || `Authoring API returned ${response.status}`;
    const error = new Error(responseType ? `${message} (${responseType})` : message);
    error.statusCode = response.status;
    error.response = parsed;
    throw error;
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const domain = normalizeDomain(required(args.domain ?? process.env.DRAFT_DOMAIN, 'DRAFT_DOMAIN'));
  const environment = normalizeEnvironment(args.environment ?? process.env.DRAFT_ENVIRONMENT);
  const validateOnly = normalizeBoolean(args['validate-only'] ?? process.env.VALIDATE_ONLY);
  const draftRoot = path.resolve(args['draft-root'] ?? process.env.DRAFT_ROOT ?? '.');
  if (!existsSync(draftRoot)) {
    throw new Error(`Draft root does not exist: ${draftRoot}`);
  }

  const files = await collectJsonFiles(draftRoot, domain);
  if (files.length === 0) {
    throw new Error(`No JSON draft files found under ${draftRoot}`);
  }
  assertValidRuntimeDataSourceConditionReferences({ version: 1, domain, stage: 'draft', files });
  const readiness = await validateDraftFeatureReadiness({ domain, environment, mode: environment, files });
  if (!readiness.ok) {
    throw new Error(`draft_feature_readiness_failed:${readiness.blockingCount}`);
  }
  const planOutput = String(args['plan-output'] ?? '').trim();
  if (planOutput) {
    const plan = buildDeploymentPlan({
      domain,
      environment,
      targetSha: process.env.GITHUB_SHA,
      versionId: args['version-id'],
      runId: process.env.GITHUB_RUN_ID,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT,
      files,
    });
    const safePlanOutput = await resolveSafePlanOutputPath(draftRoot, planOutput);
    await writeFile(safePlanOutput, `${JSON.stringify(plan, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    console.log(JSON.stringify({
      ok: true,
      domain,
      environment,
      fileCount: files.length,
      versionId: plan.versionId,
      planCreated: true,
    }, null, 2));
    return;
  }
  if (validateOnly) {
    console.log(JSON.stringify({ ok: true, domain, environment, fileCount: files.length, validatedOnly: true }, null, 2));
    return;
  }

  const endpoint = required(args.endpoint ?? process.env.AUTHORING_ENDPOINT, 'AUTHORING_ENDPOINT');
  const region = required(args.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? 'us-east-1', 'AWS_REGION');

  const gitSha = sanitizeVersionSegment(process.env.GITHUB_SHA?.slice(0, 12) ?? 'local');
  const stamp = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15);
  const versionId = sanitizeVersionSegment(args['version-id'] ?? `${stamp}-${environment}-${gitSha}`);
  const updatedBy = process.env.GITHUB_REPOSITORY
    ? `github-actions:${process.env.GITHUB_REPOSITORY}:${process.env.GITHUB_REF_NAME ?? environment}`
    : 'local-draft-deploy';

  await signedPostJson({
    endpoint,
    region,
    payload: { action: 'upsertDraft', domain, environment, versionId, updatedBy, files },
  });
  const published = await signedPostJson({
    endpoint,
    region,
    payload: { action: 'publishDraft', domain, environment, versionId, updatedBy },
  });

  console.log(JSON.stringify({ ok: true, domain, environment, versionId, published: published.published }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const safeCode = error instanceof Error && /^draft_feature_readiness_failed:\d+$/.test(error.message)
      ? error.message
      : 'draft_deploy_failed';
    console.error(JSON.stringify({ ok: false, error: { code: safeCode } }));
    process.exitCode = 1;
  });
}

export {
  assertAllowedDraftJsonPath,
  buildDeploymentPlan,
  collectJsonFiles,
  normalizeDomain,
  normalizeEnvironment,
  resolvePlanVersionId,
  resolveSafePlanOutputPath,
};
