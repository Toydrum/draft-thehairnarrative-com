import { spawnSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const SHA_PATTERN = /^[a-f0-9]{40}$/;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{1,100}$/;
const SIMILARITY_STATUS_PATTERN = /^[RC](?:100|0[0-9]{2})$/;
const TOOLING_ONLY_PATHS = new Set([
  '.github/workflows/deploy-production.yml',
  '.github/workflows/deploy-test.yml',
  '.github/workflows/guard-pr-source.yml',
  '.github/workflows/pr-safety.yml',
  'tools/deploy-draft.mjs',
  'tools/draft-feature-readiness.mjs',
  'tools/lib/sensitive-value-patterns.mjs',
  'tools/lib/server-descriptor-kinds.mjs',
  'tools/lib/server-feature-contract-validator.mjs',
  'tools/runtime-data-source-condition-guard.mjs',
  'tools/schemas/commerce.schema.json',
  'tools/schemas/data-spaces.schema.json',
  'tools/schemas/integration-bindings.schema.json',
  'tools/schemas/notification-policies.schema.json',
  'tools/verify-promotion-commit.mjs',
]);

function fail(code) {
  throw new Error(code);
}

function exactMergedPullRequests({ repository, sha, sourceBranch, targetBranch, pullRequests }) {
  if (!Array.isArray(pullRequests)) fail('promotion_api_invalid_response');
  return pullRequests.filter(pullRequest => (
    pullRequest?.state === 'closed'
    && typeof pullRequest.merged_at === 'string'
    && pullRequest.merged_at.length > 0
    && (
      pullRequest.merge_commit_sha === undefined
      || pullRequest.merge_commit_sha === null
      || pullRequest.merge_commit_sha === sha
    )
    && pullRequest.base?.ref === targetBranch
    && SHA_PATTERN.test(pullRequest.base?.sha ?? '')
    && pullRequest.base?.repo?.full_name === repository
    && pullRequest.head?.ref === sourceBranch
    && pullRequest.head?.repo?.full_name === repository
    && SHA_PATTERN.test(pullRequest.head?.sha ?? '')
  ));
}

export function validatePromotionEvidence({
  repository,
  sha,
  ref,
  sourceBranch,
  targetBranch,
  eventName,
  event,
  targetTipSha,
  parents,
  pullRequests,
}) {
  if (!REPOSITORY_PATTERN.test(repository ?? '') || !SHA_PATTERN.test(sha ?? '')) {
    fail('promotion_context_invalid');
  }
  if (!BRANCH_PATTERN.test(sourceBranch ?? '') || !BRANCH_PATTERN.test(targetBranch ?? '')) {
    fail('promotion_context_invalid');
  }
  if (ref !== `refs/heads/${targetBranch}`) fail('promotion_target_ref_mismatch');
  if (targetTipSha !== sha) fail('promotion_target_tip_mismatch');
  if (!Array.isArray(parents) || parents.length !== 2 || parents.some(parent => !SHA_PATTERN.test(parent))) {
    fail('promotion_merge_commit_required');
  }

  const matches = exactMergedPullRequests({
    repository,
    sha,
    sourceBranch,
    targetBranch,
    pullRequests,
  });
  if (matches.length === 0) fail('promotion_pr_not_found');
  if (matches.length !== 1) fail('promotion_pr_ambiguous');
  const pullRequest = matches[0];
  if (parents[0] !== pullRequest.base.sha) fail('promotion_first_parent_mismatch');
  if (parents[1] !== pullRequest.head.sha) fail('promotion_second_parent_mismatch');

  if (eventName === 'push') {
    if (event?.forced === true || event?.created === true || event?.deleted === true) {
      fail('promotion_push_not_allowed');
    }
    if (event?.after !== sha || !SHA_PATTERN.test(event?.before ?? '') || /^0+$/.test(event.before)) {
      fail('promotion_push_not_allowed');
    }
    if (parents[0] !== event.before) fail('promotion_first_parent_mismatch');
  } else if (eventName !== 'workflow_dispatch') {
    fail('promotion_event_not_allowed');
  }

  return { ok: true };
}

export function classifyPromotionChanges({ eventName, changes }) {
  if (!Array.isArray(changes)) fail('promotion_diff_invalid');
  let deployRequired = false;

  for (const change of changes) {
    const status = typeof change?.status === 'string' ? change.status : '';
    const kind = status[0];
    const isKnown = /^[AMDT]$/.test(status) || SIMILARITY_STATUS_PATTERN.test(status);
    if (!isKnown || typeof change?.path !== 'string' || change.path.length === 0) {
      fail('promotion_diff_invalid');
    }
    const affectedPaths = [change.path];
    if (kind === 'R' || kind === 'C') {
      if (typeof change.previousPath !== 'string' || change.previousPath.length === 0) {
        fail('promotion_diff_invalid');
      }
      affectedPaths.push(change.previousPath);
    }
    if (!['A', 'M'].includes(kind) && affectedPaths.some(candidate => TOOLING_ONLY_PATHS.has(candidate))) {
      fail('promotion_tooling_change_unsafe');
    }
    if (!['A', 'M'].includes(kind) || !TOOLING_ONLY_PATHS.has(change.path)) {
      deployRequired = true;
    }
  }

  if (eventName === 'workflow_dispatch') return { deployRequired: true, reason: 'manual_dispatch' };
  if (eventName !== 'push') fail('promotion_event_not_allowed');
  return deployRequired
    ? { deployRequired: true, reason: 'content_or_non_allowlisted_change' }
    : { deployRequired: false, reason: 'tooling_only' };
}

export async function fetchAssociatedPullRequests({
  apiUrl,
  repository,
  sha,
  githubToken,
  attempts = 3,
  retryDelayMs = 1500,
  fetchImpl = fetch,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
}) {
  if (!REPOSITORY_PATTERN.test(repository ?? '') || !SHA_PATTERN.test(sha ?? '')) {
    fail('promotion_context_invalid');
  }
  if (typeof githubToken !== 'string' || githubToken.length < 1) fail('promotion_api_token_missing');
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) fail('promotion_retry_policy_invalid');
  const baseUrl = new URL(apiUrl ?? 'https://api.github.com');
  if (baseUrl.protocol !== 'https:') fail('promotion_api_url_invalid');
  const [owner, repo] = repository.split('/');
  const url = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${sha}/pulls?per_page=100`, baseUrl);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubToken}`,
          'User-Agent': 'zoolanding-draft-promotion-guard',
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
    } catch {
      if (attempt === attempts) fail('promotion_api_unavailable');
      await sleep(retryDelayMs);
      continue;
    }
    if (!response?.ok) fail('promotion_api_unavailable');

    let body;
    try {
      body = await response.json();
    } catch {
      fail('promotion_api_invalid_response');
    }
    if (!Array.isArray(body) || body.length > 100) fail('promotion_api_invalid_response');
    if (body.length > 0 || attempt === attempts) return body;
    await sleep(retryDelayMs);
  }
  fail('promotion_api_unavailable');
}

export async function fetchTargetBranchSha({
  apiUrl,
  repository,
  targetBranch,
  githubToken,
  attempts = 3,
  retryDelayMs = 1500,
  fetchImpl = fetch,
  sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
}) {
  if (!REPOSITORY_PATTERN.test(repository ?? '') || !BRANCH_PATTERN.test(targetBranch ?? '')) {
    fail('promotion_context_invalid');
  }
  if (typeof githubToken !== 'string' || githubToken.length < 1) fail('promotion_api_token_missing');
  if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 3) fail('promotion_retry_policy_invalid');
  const baseUrl = new URL(apiUrl ?? 'https://api.github.com');
  if (baseUrl.protocol !== 'https:') fail('promotion_api_url_invalid');
  const [owner, repo] = repository.split('/');
  const url = new URL(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(targetBranch)}`, baseUrl);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(url, {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${githubToken}`,
          'User-Agent': 'zoolanding-draft-promotion-guard',
          'X-GitHub-Api-Version': '2026-03-10',
        },
      });
    } catch {
      if (attempt === attempts) fail('promotion_api_unavailable');
      await sleep(retryDelayMs);
      continue;
    }
    if (!response?.ok) fail('promotion_api_unavailable');
    let body;
    try {
      body = await response.json();
    } catch {
      fail('promotion_api_invalid_response');
    }
    if (!SHA_PATTERN.test(body?.commit?.sha ?? '')) fail('promotion_api_invalid_response');
    return body.commit.sha;
  }
  fail('promotion_api_unavailable');
}

export async function verifyPromotion({
  repository,
  sha,
  ref,
  sourceBranch,
  targetBranch,
  eventName,
  event,
  parents,
  changes,
  githubToken,
  apiUrl = 'https://api.github.com',
  fetchTargetSha = fetchTargetBranchSha,
  fetchPullRequests = fetchAssociatedPullRequests,
}) {
  const fetchTarget = () => fetchTargetSha({
    apiUrl,
    repository,
    targetBranch,
    githubToken,
  });
  const initialTargetTip = await fetchTarget();
  if (initialTargetTip !== sha) fail('promotion_target_tip_mismatch');
  const pullRequests = await fetchPullRequests({
    apiUrl,
    repository,
    sha,
    githubToken,
  });
  validatePromotionEvidence({
    repository,
    sha,
    ref,
    sourceBranch,
    targetBranch,
    eventName,
    event,
    targetTipSha: initialTargetTip,
    parents,
    pullRequests,
  });
  if (await fetchTarget() !== sha) fail('promotion_target_tip_mismatch');
  return classifyPromotionChanges({ eventName, changes });
}

function parseArgs(argv) {
  return Object.fromEntries(argv.map(argument => {
    const match = /^--([^=]+)=(.+)$/.exec(argument);
    if (!match) fail('promotion_arguments_invalid');
    return [match[1], match[2]];
  }));
}

function readParents(sha) {
  const result = spawnSync('git', ['rev-list', '--parents', '-n', '1', sha], {
    encoding: 'utf8',
    maxBuffer: 4096,
    windowsHide: true,
  });
  if (result.status !== 0) fail('promotion_git_evidence_unavailable');
  const parts = result.stdout.trim().split(/\s+/);
  if (parts[0] !== sha) fail('promotion_git_evidence_invalid');
  return parts.slice(1);
}

function parsePromotionDiff(output) {
  if (!Buffer.isBuffer(output)) fail('promotion_diff_invalid');
  const fields = output.toString('utf8').split('\0');
  if (fields.at(-1) === '') fields.pop();
  const changes = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (SIMILARITY_STATUS_PATTERN.test(status)) {
      const previousPath = fields[index++];
      const changedPath = fields[index++];
      if (!previousPath || !changedPath) fail('promotion_diff_invalid');
      changes.push({ status, previousPath, path: changedPath });
      continue;
    }
    if (!/^[AMDT]$/.test(status)) fail('promotion_diff_invalid');
    const changedPath = fields[index++];
    if (!changedPath) fail('promotion_diff_invalid');
    changes.push({ status, path: changedPath });
  }
  return changes;
}

function readPromotionChanges(sha, firstParent) {
  const result = spawnSync('git', [
    'diff',
    '--name-status',
    '-z',
    '--no-renames',
    '--no-ext-diff',
    '--no-textconv',
    firstParent,
    sha,
    '--',
  ], {
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.status !== 0) fail('promotion_git_evidence_unavailable');
  return parsePromotionDiff(result.stdout);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  if (args['tip-only'] === 'true') {
    const targetTipSha = await fetchTargetBranchSha({
      apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
      repository,
      targetBranch: args.target,
      githubToken: process.env.GITHUB_TOKEN,
    });
    if (targetTipSha !== sha) fail('promotion_target_tip_mismatch');
    console.log('promotion_target_tip_verified');
    return;
  }

  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!eventPath) fail('promotion_event_missing');
  let event;
  try {
    const rawEvent = await readFile(eventPath, 'utf8');
    if (Buffer.byteLength(rawEvent, 'utf8') > 1024 * 1024) fail('promotion_event_invalid');
    event = JSON.parse(rawEvent);
  } catch (error) {
    if (error?.message === 'promotion_event_invalid') throw error;
    fail('promotion_event_invalid');
  }

  const parents = readParents(sha);
  const result = await verifyPromotion({
    repository,
    sha,
    ref: process.env.GITHUB_REF,
    sourceBranch: args.source,
    targetBranch: args.target,
    eventName: process.env.GITHUB_EVENT_NAME,
    event,
    parents,
    changes: readPromotionChanges(sha, parents[0]),
    githubToken: process.env.GITHUB_TOKEN,
    apiUrl: process.env.GITHUB_API_URL ?? 'https://api.github.com',
  });
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `deploy_required=${result.deployRequired}\n`, 'utf8');
  }
  console.log('promotion_provenance_verified');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    const message = typeof error?.message === 'string' && /^promotion_[a-z_]+$/.test(error.message)
      ? error.message
      : 'promotion_verification_failed';
    console.error(message);
    process.exitCode = 1;
  });
}
