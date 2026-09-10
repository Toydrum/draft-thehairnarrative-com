import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertAllowedDraftJsonPath } from './deploy-draft.mjs';
import { validateDraftFeatureReadiness } from './draft-feature-readiness.mjs';

const DOMAIN = 'thehairnarrative.com';
const REPOSITORY = 'Toydrum/draft-thehairnarrative-com';
const hash = value => createHash('sha256').update(value).digest('hex');
const deny = () => { throw new Error('Journal rollback evidence rejected.'); };

export async function prepareRollback({ planBytes, manifestBytes, expectedManifestSha256, expectedArtifactId, sourceRun, artifact }) {
  try {
    if (!/^[a-f0-9]{64}$/.test(expectedManifestSha256) || hash(manifestBytes) !== expectedManifestSha256) deny();
    const checksumLine = manifestBytes.toString('utf8');
    if (!/^[a-f0-9]{64}  deployment-plan\.json\n$/.test(checksumLine) || checksumLine.slice(0, 64) !== hash(planBytes)) deny();
    if (!/^[1-9][0-9]{0,19}$/.test(expectedArtifactId) || String(artifact.id) !== expectedArtifactId || artifact.expired !== false) deny();
    const runId = String(sourceRun.id);
    const attempt = String(sourceRun.run_attempt);
    const sha = sourceRun.head_sha;
    if (!/^[1-9][0-9]{0,19}$/.test(runId) || !/^[1-9][0-9]{0,9}$/.test(attempt) || !/^[a-f0-9]{40}$/.test(sha)) deny();
    if (sourceRun.repository?.full_name !== REPOSITORY || sourceRun.path !== '.github/workflows/deploy-test.yml'
      || sourceRun.head_branch !== 'test' || sourceRun.status !== 'completed' || sourceRun.conclusion !== 'success'
      || !['push', 'workflow_dispatch'].includes(sourceRun.event)
      || artifact.name !== `draft-plan-test-${runId}-${attempt}-${sha}`
      || String(artifact.workflow_run?.id) !== runId || artifact.workflow_run.head_sha !== sha
      || artifact.workflow_run.head_branch !== 'test') deny();
    const plan = JSON.parse(planBytes);
    const versionId = `test-${sha}-${runId}-${attempt}`;
    if (Object.keys(plan).sort().join(',') !== 'actions,domain,environment,files,schemaVersion,targetSha,versionId'
      || plan.schemaVersion !== 1 || plan.domain !== DOMAIN || plan.environment !== 'test' || plan.targetSha !== sha
      || plan.versionId !== versionId || JSON.stringify(plan.actions) !== '["upsertDraft","publishDraft"]'
      || !Array.isArray(plan.files) || !plan.files.length) deny();
    for (const file of plan.files) assertAllowedDraftJsonPath(DOMAIN, file.path);
    const readiness = await validateDraftFeatureReadiness({ domain: DOMAIN, environment: 'test', mode: 'test', files: plan.files });
    if (!readiness.ok) deny();
    return { schemaVersion: 1, mode: 'selection-only', activationAllowed: false, deployed: false,
      action: 'publishDraft', domain: DOMAIN, environment: 'test', versionId, sourceCommit: sha,
      sourceRunId: runId, sourceRunAttempt: attempt, artifactId: expectedArtifactId, manifestSha256: expectedManifestSha256 };
  } catch { deny(); }
}

async function main() {
  if (process.argv.length !== 2) deny();
  const result = await prepareRollback({
    planBytes: await readFile(process.env.ROLLBACK_PLAN_PATH),
    manifestBytes: await readFile(process.env.ROLLBACK_MANIFEST_PATH),
    sourceRun: JSON.parse(await readFile(process.env.ROLLBACK_RUN_METADATA_PATH, 'utf8')),
    artifact: JSON.parse(await readFile(process.env.ROLLBACK_ARTIFACT_METADATA_PATH, 'utf8')),
    expectedManifestSha256: process.env.ROLLBACK_MANIFEST_SHA256,
    expectedArtifactId: process.env.ROLLBACK_ARTIFACT_ID,
  });
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Journal rollback evidence rejected.'); process.exitCode = 1; });
}
