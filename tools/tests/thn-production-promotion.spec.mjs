import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const moduleUrl = new URL('../verify-thn-production-promotion.mjs', import.meta.url);
const sourceSha = 'a'.repeat(40), sourceTree = 'b'.repeat(40), targetBaseSha = 'c'.repeat(40), mergeTree = 'd'.repeat(40), sha = 'e'.repeat(40);
const selector = { schemaVersion: 1, mode: 'thn-source-only', sourceSha, sourceTree, targetBaseSha, mergeTree };
const context = { eventName: 'push', ref: 'refs/heads/main', sha, parents: [targetBaseSha, sourceSha], sourceSha, sourceTree, mergeTree,
  event: { before: targetBaseSha, after: sha, forced: false, created: false, deleted: false } };
test('production source-only gate requires the exact native merge tree and current TEST coordinates', async () => {
  assert.ok(existsSync(moduleUrl), 'production promotion needs an executable fail-closed selector before credentials');
  const { validateSourceOnlyPromotion } = await import(moduleUrl.href);
  assert.deepEqual(validateSourceOnlyPromotion(selector, context), { sourceOnly: true });
  for (const mutate of [s => s.sourceSha = sha, s => s.sourceTree = sha, s => s.targetBaseSha = sha, s => s.mergeTree = sha,
    s => s.mode = 'deploy', s => s.schemaVersion = 2, s => s.extra = true]) {
    const changed = structuredClone(selector); mutate(changed);
    assert.throws(() => validateSourceOnlyPromotion(changed, context), /production_promotion_/);
  }
  for (const changed of [undefined, {}, { ...selector, sourceSha: 'a' }, JSON.stringify(selector)]) assert.throws(() => validateSourceOnlyPromotion(changed, context), /production_promotion_/);
  for (const changed of [{ ...context, ref: 'refs/heads/test' }, { ...context, parents: [sourceSha, targetBaseSha] }, { ...context, eventName: 'workflow_dispatch' },
    { ...context, event: { ...context.event, forced: true } }, { ...context, sourceTree: sha }, { ...context, mergeTree: sha }]) assert.throws(() => validateSourceOnlyPromotion(selector, changed), /production_promotion_/);
});
test('draft production push proves its exact source-only selection before plan or credentials', async () => {
  const workflow=await readFile(new URL('../../.github/workflows/deploy-production.yml',import.meta.url),'utf8');
  assert.match(workflow,/PRODUCTION_PROMOTION_SELECTION_JSON: \$\{\{ vars.DRAFT_PRODUCTION_PROMOTION_SELECTION_JSON \}\}/);
  assert.ok(workflow.indexOf('node tools/verify-thn-production-promotion.mjs')<workflow.indexOf('--plan-output='));
  assert.match(workflow,/deploy_required: \$\{\{ steps.provenance.outputs.deploy_required == 'true' && steps.release_mode.outputs.source_only != 'true' \}\}/);
  assert.match(workflow,/if: needs.validate.outputs.deploy_required == 'true'/);
  assert.ok(workflow.indexOf('Validate artifact manifest and closed deployment plan')<workflow.indexOf('aws-actions/configure-aws-credentials'));
});


test('raw selector rejects duplicate coordinates including escaped JSON keys', async () => {
  const module = await import(moduleUrl.href);
  assert.equal(typeof module.parseSourceOnlyPromotionSelection, 'function', 'raw workflow selectors need duplicate-key rejection before JSON values are collapsed');
  const valid = JSON.stringify(selector);
  assert.deepEqual(module.parseSourceOnlyPromotionSelection(valid), selector);
  assert.deepEqual(module.parseSourceOnlyPromotionSelection('  '+valid+'\n'), selector);
  for (const duplicate of ['sourceSha', 'sourceTree', 'targetBaseSha', 'mergeTree', 'mode', 'schemaVersion']) {
    const raw = '{'+JSON.stringify(duplicate)+':null,'+valid.slice(1);
    assert.throws(() => module.parseSourceOnlyPromotionSelection(raw), /production_promotion_/);
  }
  const escaped = '{"source\\u0053ha":null,'+valid.slice(1);
  assert.throws(() => module.parseSourceOnlyPromotionSelection(escaped), /production_promotion_/);
  for(const invalid of ['', 'null', '[]', '{"sourceSha":{}}', valid+' trailing', '{"sourceSha":1,"sourceSha":2}']) {
    assert.throws(() => module.parseSourceOnlyPromotionSelection(invalid), /production_promotion_/);
  }
});


test('CLI rejects duplicate raw selection before requesting remote evidence', () => {
  const raw = '{"sourceSha":null,'+JSON.stringify(selector).slice(1);
  const script = `globalThis.fetch=()=>{console.log('REMOTE_EVIDENCE_REQUESTED');throw Error('unexpected remote call')};process.argv[1]=${JSON.stringify(fileURLToPath(moduleUrl))};await import(${JSON.stringify(moduleUrl.href)});`;
  const result = spawnSync(process.execPath, ['--input-type=module','-e',script], {encoding:'utf8',env:{...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_REPOSITORY:'Toydrum/draft-thehairnarrative-com',GITHUB_TOKEN:'synthetic-test-token',PRODUCTION_PROMOTION_SELECTION_JSON:raw}});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/production_promotion_selection_invalid/);
  assert.doesNotMatch(result.stdout,/REMOTE_EVIDENCE_REQUESTED/);
});


test('TEST source-only selection closes native DEV merge and rejects stale/event/duplicate evidence', async () => {
  const {validateSourceOnlyPromotion,parseSourceOnlyPromotionSelection}=await import(moduleUrl.href);
  const testContext={...context,targetBranch:'test',ref:'refs/heads/test'};
  assert.deepEqual(validateSourceOnlyPromotion(selector,testContext),{sourceOnly:true});
  for(const changed of [{...testContext,ref:'refs/heads/main'}, {...testContext,targetBranch:'dev'}, {...testContext,sourceSha:sha},
    {...testContext,eventName:'workflow_dispatch'}, {...testContext,event:{...testContext.event,forced:true}}, {...testContext,parents:[sourceSha,targetBaseSha]}]) {
    assert.throws(()=>validateSourceOnlyPromotion(selector,changed),/production_promotion_/);
  }
  for(const raw of ['', '{"mode":"wrong",'+JSON.stringify(selector).slice(1), JSON.stringify({...selector,unknown:true})]) {
    assert.throws(()=>parseSourceOnlyPromotionSelection(raw),/production_promotion_/);
  }
  const workflow=await readFile(new URL('../../.github/workflows/deploy-test.yml',import.meta.url),'utf8');
  assert.match(workflow,/TEST_PROMOTION_SELECTION_JSON: \$\{\{ vars.DRAFT_TEST_PROMOTION_SELECTION_JSON \}\}/);
  assert.ok(workflow.indexOf('node tools/verify-thn-production-promotion.mjs')<workflow.indexOf('--plan-output='));
  assert.match(workflow,/deploy_required: \$\{\{ steps.provenance.outputs.deploy_required == 'true' && steps.release_mode.outputs.source_only != 'true' \}\}/);
});

test('TEST CLI executes a real native merge proof before allowing source-only and refuses source drift', async () => {
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const root=mkdtempSync(join(tmpdir(),'thn-draft-native-'));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 try {
  git('init','-b','test');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture');
  writeFileSync(join(root,'base.txt'),'base');git('add','.');git('commit','-m','base');
  git('checkout','-b','dev');writeFileSync(join(root,'source.txt'),'source');git('add','.');git('commit','-m','source');const src=git('rev-parse','HEAD'),tree=git('rev-parse','HEAD^{tree}');
  git('checkout','test');writeFileSync(join(root,'target-only.txt'),'target');git('add','.');git('commit','-m','target');const target=git('rev-parse','HEAD');
  git('merge','--no-ff','dev','-m','promotion');const merge=git('rev-parse','HEAD'),mergedTree=git('rev-parse','HEAD^{tree}');
  const selection={schemaVersion:1,mode:'thn-source-only',sourceSha:src,sourceTree:tree,targetBaseSha:target,mergeTree:mergedTree};
  const eventPath=join(root,'event.json');writeFileSync(eventPath,JSON.stringify({before:target,after:merge,forced:false,created:false,deleted:false}));
  const runner=remote=>`globalThis.fetch=async url=>({ok:url.endsWith('/dev'),json:async()=>({object:{sha:${JSON.stringify(remote)}}})});process.argv[1]=${JSON.stringify(fileURLToPath(moduleUrl))};await import(${JSON.stringify(moduleUrl.href)});`;
  const env={...process.env,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/test',GITHUB_SHA:merge,GITHUB_REPOSITORY:'Toydrum/draft-thehairnarrative-com',GITHUB_TOKEN:'synthetic-test-token',GITHUB_EVENT_PATH:eventPath,TEST_PROMOTION_SELECTION_JSON:JSON.stringify(selection)};
  const run=(remote,overrides={})=>spawnSync(process.execPath,['--input-type=module','-e',runner(remote)],{cwd:root,encoding:'utf8',env:{...env,...overrides}});
  const valid=run(src);assert.equal(valid.status,0,valid.stderr);assert.match(valid.stdout,/source_only_verified/);
  assert.notEqual(run(target).status,0);assert.notEqual(run(src,{TEST_PROMOTION_SELECTION_JSON:''}).status,0);
  assert.notEqual(run(src,{TEST_PROMOTION_SELECTION_JSON:'{"sourceSha":null,'+JSON.stringify(selection).slice(1)}).status,0);
  writeFileSync(eventPath,JSON.stringify({before:target,after:merge,forced:true,created:false,deleted:false}));assert.notEqual(run(src).status,0);
 } finally {rmSync(root,{recursive:true,force:true});}
});
