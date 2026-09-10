import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { collectJsonFiles, validateDraftFeatureReadiness } from '../draft-feature-readiness.mjs';
import { fileURLToPath } from 'node:url';
import { inferServerDescriptorKind } from '../lib/server-descriptor-kinds.mjs';

const domain = 'thehairnarrative.com';
const sha = 'a'.repeat(40);
const hash = value => createHash('sha256').update(value).digest('hex');
const binding = { bindingId: 'journal-v2', domain, environment: 'test', authProfileId: 'journal-owner', featureId: 'journal',
  hubId: 'thehairnarrative-com-journal', serviceBindingId: 'thn-journal-test-v2', authBasePath: '/auth-v2', contentHubBasePath: '/features/content-hub-v2', status: 'active' };
const site = { version: 1, domain, runtime: { authRemote: { authProfileId: 'journal-owner', requiredOrigin: 'https://admin-test.thehairnarrative.com' } } };
const files = () => [
  { path: `${domain}/site-config.json`, kind: 'site-config', content: structuredClone(site) },
  { path: `${domain}/server/protected-feature-bindings-v2.json`, kind: 'server-protected-feature-bindings-v2', content: structuredClone(binding) },
];

test('the complete Journal package passes the unchanged TEST readiness gate', async () => {
  const actual = await collectJsonFiles(fileURLToPath(new URL('../../', import.meta.url)), domain);
  const report = await validateDraftFeatureReadiness({ domain, environment: 'test', mode: 'test', files: actual });
  assert.deepEqual(report.findings, []);
  assert.equal(report.ok, true);
});

test('the real package includes the closed server-only binding without deployment resource identifiers', async () => {
  const actual = await collectJsonFiles(fileURLToPath(new URL('../../', import.meta.url)), domain);
  const descriptor = actual.find(file => file.path === `${domain}/server/protected-feature-bindings-v2.json`);
  assert.ok(descriptor, 'The connected private desk requires its server-only binding');
  assert.deepEqual(descriptor.content, binding);
  assert.equal(inferServerDescriptorKind(domain, descriptor.path), 'server-protected-feature-bindings-v2');
});

test('all private login labels resolve without using a reserved credential field name', async () => {
  for (const pageId of ['admin-journal-access', 'admin-journal-mfa', 'admin-journal', 'admin-journal-new', 'admin-journal-edit', 'admin-journal-preview']) {
    const components = JSON.parse(await readFile(new URL(`../../${pageId}/components.json`, import.meta.url), 'utf8')).components;
    assert.ok(components.some(component => component.valueInstructions === 'set:config.label,i18n,desk.passwordLabel'));
    for (const lang of ['en', 'es']) {
      const dictionary = JSON.parse(await readFile(new URL(`../../${pageId}/i18n/${lang}.json`, import.meta.url), 'utf8')).dictionary.desk;
      assert.equal(dictionary.passwordLabel, lang === 'en' ? 'Password' : 'Contraseña');
      assert.equal(Object.hasOwn(dictionary, 'password'), false);
    }
  }
});

test('THN tooling accepts only the closed server binding at the isolated TEST origin', async () => {
  assert.equal(inferServerDescriptorKind(domain, `${domain}/server/protected-feature-bindings-v2.json`), 'server-protected-feature-bindings-v2');
  const check = items => validateDraftFeatureReadiness({ domain, environment: 'test', mode: 'test', files: items });
  assert.equal((await check(files())).ok, true);
  for (const change of ['origin', 'scope', 'kind', 'extra', 'missing']) {
    const items = files();
    if (change === 'origin') items[0].content.runtime.authRemote.requiredOrigin = 'https://test.zoolandingpage.com.mx';
    if (change === 'scope') items[1].content.domain = 'zoositioweb.com.mx';
    if (change === 'kind') items[1].kind = 'site-config';
    if (change === 'extra') items[1].content.writerMode = 'enabled';
    if (change === 'missing') items.pop();
    assert.equal((await check(items)).ok, false, change);
  }
  assert.equal((await validateDraftFeatureReadiness({ domain, environment: 'production', mode: 'production', files: files() })).ok, false);
  assert.equal((await check([{ path: `${domain}/site-config.json`, kind: 'site-config', content: { version: 1, domain } }])).ok, true);
});

async function rollbackTool() {
  const url = new URL('../prepare-journal-rollback.mjs', import.meta.url);
  assert.equal(existsSync(url), true, 'verified immutable rollback selector must exist');
  return import(url.href);
}

function rollbackInput() {
  const plan = { schemaVersion: 1, domain, environment: 'test', targetSha: sha, versionId: `test-${sha}-123-2`,
    actions: ['upsertDraft', 'publishDraft'], files: files() };
  const planBytes = Buffer.from(JSON.stringify(plan));
  const manifestBytes = Buffer.from(`${hash(planBytes)}  deployment-plan.json\n`);
  return { planBytes, manifestBytes, expectedManifestSha256: hash(manifestBytes), expectedArtifactId: '456',
    sourceRun: { id: 123, run_attempt: 2, head_sha: sha, head_branch: 'test', path: '.github/workflows/deploy-test.yml',
      repository: { full_name: 'Toydrum/draft-thehairnarrative-com' }, status: 'completed', conclusion: 'success', event: 'push' },
    artifact: { id: 456, expired: false, name: `draft-plan-test-123-2-${sha}`, workflow_run: { id: 123, head_sha: sha, head_branch: 'test' } } };
}

test('rollback selects only a successfully published recorded version without upserting or activating', async () => {
  const api = await rollbackTool();
  const result = await api.prepareRollback(rollbackInput());
  assert.equal(result.versionId, `test-${sha}-123-2`);
  assert.equal(result.action, 'publishDraft');
  assert.equal(result.activationAllowed, false);
  assert.equal(result.deployed, false);
  assert.equal(Object.hasOwn(result, 'files'), false);
});

for (const mutation of ['digest', 'artifact', 'attempt', 'workflow', 'repository', 'branch', 'failed', 'expired', 'version', 'plan']) {
  test(`rollback rejects ${mutation} mismatch`, async () => {
    const api = await rollbackTool();
    const input = rollbackInput();
    if (mutation === 'digest') input.expectedManifestSha256 = '0'.repeat(64);
    if (mutation === 'artifact') input.expectedArtifactId = '789';
    if (mutation === 'attempt') input.sourceRun.run_attempt = 3;
    if (mutation === 'workflow') input.sourceRun.path = '.github/workflows/other.yml';
    if (mutation === 'repository') input.sourceRun.repository.full_name = 'other/draft';
    if (mutation === 'branch') input.sourceRun.head_branch = 'dev';
    if (mutation === 'failed') input.sourceRun.conclusion = 'failure';
    if (mutation === 'expired') input.artifact.expired = true;
    if (mutation === 'version') {
      const plan = JSON.parse(input.planBytes);
      plan.versionId = `test-${sha}-123-3`;
      input.planBytes = Buffer.from(JSON.stringify(plan));
      input.manifestBytes = Buffer.from(`${hash(input.planBytes)}  deployment-plan.json\n`);
      input.expectedManifestSha256 = hash(input.manifestBytes);
    }
    if (mutation === 'plan') input.planBytes = Buffer.from('{}');
    await assert.rejects(() => api.prepareRollback(input), /rollback/i);
  });
}

test('TEST workflow keeps exact promotion, no privileged repository code, and validates the v2 kind', async () => {
  const workflow = await readFile(new URL('../../.github/workflows/deploy-test.yml', import.meta.url), 'utf8');
  assert.match(workflow, /node --test tools\/tests\/journal-delivery.spec.mjs/);
  assert.match(workflow, /retention-days: 90/);
  assert.match(workflow, /protected-feature-bindings-v2.json.*server-protected-feature-bindings-v2/);
  assert.match(workflow, /--source=dev --target=test/);
  const deploy = workflow.slice(workflow.indexOf('\n  deploy:'));
  assert.doesNotMatch(deploy, /actions\/checkout|npm ci|run: node/);
  assert.match(deploy, /EXPECTED_MANIFEST_SHA256/);
  assert.match(workflow, /Record immutable rollback coordinates/);
});

test('Journal contracts run in pull requests without deployment credentials', async () => {
  const url = new URL('../../.github/workflows/validate-journal.yml', import.meta.url);
  assert.equal(existsSync(url), true, 'credential-free Journal validation must exist');
  const workflow = await readFile(url, 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /node --test tools\/tests\/\*\.spec.mjs/);
  assert.doesNotMatch(workflow, /id-token: write|environment: test|configure-aws-credentials/);
});

test('the actual privileged jq filter accepts the exact v2 kind and rejects structural drift', async () => {
  const workflow = (await readFile(new URL('../../.github/workflows/deploy-test.yml', import.meta.url), 'utf8')).replace(/\r\n/g, '\n');
  const start = '            --arg version "$EXPECTED_VERSION_ID" \'';
  const offset = workflow.indexOf(start) + start.length;
  const end = workflow.indexOf('\n            \' "$PLAN_PATH"', offset);
  assert.ok(offset >= start.length && end > offset);
  const filter = workflow.slice(offset, end);
  const plan = JSON.parse(rollbackInput().planBytes);
  const check = payload => spawnSync(process.env.JQ_PATH || 'jq', ['-e', '--arg', 'domain', domain,
    '--arg', 'environment', 'test', '--arg', 'sha', sha, '--arg', 'version', plan.versionId, filter],
  { input: JSON.stringify(payload), encoding: 'utf8', windowsHide: true });
  const result = check(plan);
  assert.equal(result.status, 0, result.error?.message || result.stderr);
  for (const mutation of ['kind', 'cross-draft', 'unknown-root', 'duplicate', 'private-path']) {
    const changed = structuredClone(plan);
    if (mutation === 'kind') changed.files[1].kind = 'site-config';
    if (mutation === 'cross-draft') changed.files[1].path = 'zoositioweb.com.mx/server/protected-feature-bindings-v2.json';
    if (mutation === 'unknown-root') changed.writerMode = 'enabled';
    if (mutation === 'duplicate') changed.files.push(changed.files[0]);
    if (mutation === 'private-path') changed.files[1].path = `${domain}/server/private-registry.json`;
    assert.notEqual(check(changed).status, 0, mutation);
  }
});
