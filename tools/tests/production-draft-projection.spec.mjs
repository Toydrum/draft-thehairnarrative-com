import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { collectJsonFiles, buildDeploymentPlan } from '../deploy-draft.mjs';
const domain = 'thehairnarrative.com';
test('production plan projects only verified THN environment and private canonical coordinates without rewriting source', async () => {
  const moduleUrl = new URL('../lib/thn-draft-environment.mjs', import.meta.url);
  assert.ok(existsSync(moduleUrl), 'production draft needs explicit closed projection');
  const { projectThnDraftEnvironment } = await import(moduleUrl.href);
  const source = await collectJsonFiles(fileURLToPath(new URL('../../', import.meta.url)), domain);
  const frozen = structuredClone(source);
  const production = projectThnDraftEnvironment({ domain, environment: 'production', files: source });
  assert.deepEqual(source, frozen);
  assert.equal(production.length, source.length);
  for (let i=0; i<source.length; i++) {
    const path = source[i].path;
    if (path.includes('/admin-journal') && path.endsWith('/page-config.json')) {
      assert.match(production[i].content.seo.canonical,/^https:\/\/admin\.thehairnarrative\.com\/admin\/journal/);
      const expected=structuredClone(source[i]);expected.content.seo.canonical=expected.content.seo.canonical.replace('https://admin-test.thehairnarrative.com','https://admin.thehairnarrative.com');assert.deepEqual(production[i],expected);
    } else if (!path.endsWith('/site-config.json') && !path.endsWith('/server/protected-feature-bindings-v2.json')) assert.deepEqual(production[i], source[i], path);
  }
  assert.equal(production.find(f=>f.path.endsWith('/site-config.json')).content.runtime.authRemote.requiredOrigin, 'https://admin.thehairnarrative.com');
  const binding = production.find(f=>f.path.endsWith('/server/protected-feature-bindings-v2.json')).content;
  assert.equal(binding.environment, 'production'); assert.equal(binding.serviceBindingId, 'thn-journal-production-v2');
  for (const mutate of [v=>v.find(f=>f.path.endsWith('/site-config.json')).content.runtime.authRemote.requiredOrigin='https://attacker.test',
    v=>v.find(f=>f.path.endsWith('/server/protected-feature-bindings-v2.json')).content.serviceBindingId='other-binding',
    v=>v.find(f=>f.path.endsWith('/server/protected-feature-bindings-v2.json')).content.extra=true,
    v=>v.find(f=>f.path.endsWith('/admin-journal-access/page-config.json')).content.seo.canonical='https://attacker.test/admin/journal/access']) {
    const invalid = structuredClone(source); mutate(invalid);
    assert.throws(()=>projectThnDraftEnvironment({domain,environment:'production',files:invalid}), /projection_rejected/);
  }
  assert.throws(()=>projectThnDraftEnvironment({domain,environment:'production',files:production}), /projection_rejected/);
});
test('actual production credential filter accepts production binding and rejects TEST or origin drift', async () => {
  const { projectThnDraftEnvironment } = await import('../lib/thn-draft-environment.mjs');
  const source = await collectJsonFiles(fileURLToPath(new URL('../../', import.meta.url)), domain);
  const files = projectThnDraftEnvironment({domain,environment:'production',files:source});
  const sha = 'a'.repeat(40);
  const plan = buildDeploymentPlan({domain,environment:'production',targetSha:sha,runId:'123',runAttempt:'1',files});
  const workflow = (await readFile(new URL('../../.github/workflows/deploy-production.yml', import.meta.url), 'utf8')).replace(/\r\n/g,'\n');
  const start = "--arg version \"$EXPECTED_VERSION_ID\" '\n";
  const offset = workflow.indexOf(start) + start.length;
  const end = workflow.indexOf("\n            ' \"$PLAN_PATH\"", offset);
  assert.ok(offset >= start.length && end > offset);
  const filter = workflow.slice(offset,end);
  const check = payload => spawnSync(process.env.JQ_PATH || 'jq',['-e','--arg','domain',domain,'--arg','environment','production','--arg','sha',sha,'--arg','version',plan.versionId,filter],
    {input:JSON.stringify(payload),encoding:'utf8',windowsHide:true});
  assert.equal(check(plan).status,0,check(plan).stderr);
  for(const mutate of [p=>p.files.find(f=>f.path.endsWith('/server/protected-feature-bindings-v2.json')).content.environment='test',
    p=>p.files.find(f=>f.path.endsWith('/server/protected-feature-bindings-v2.json')).content.serviceBindingId='thn-journal-test-v2',
    p=>p.files.find(f=>f.path.endsWith('/site-config.json')).content.runtime.authRemote.requiredOrigin='https://admin-test.thehairnarrative.com']){
    const changed=structuredClone(plan);mutate(changed);assert.notEqual(check(changed).status,0);
  }
});
