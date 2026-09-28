import { spawnSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const shaPattern = /^[a-f0-9]{40}$/;
const fail = code => { throw new Error(`production_promotion_${code}`); };

// This selector is a flat six-field contract. Scan its raw keys before JSON.parse
// can discard a duplicate, including differently escaped spellings of a key.
export function parseSourceOnlyPromotionSelection(raw) {
  if (typeof raw !== 'string' || raw.length === 0 || Buffer.byteLength(raw) > 4096) fail('selection_invalid');
  const text = raw.trim();
  let value;
  try { value = JSON.parse(text); } catch { fail('selection_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('selection_invalid');
  const pair = /\s*("(?:\\.|[^"\\])*")\s*:\s*("(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*([,}])/y;
  const seen = new Set();
  let index = 1;
  if (text[0] !== '{') fail('selection_invalid');
  while (index < text.length) {
    pair.lastIndex = index;
    const match = pair.exec(text);
    if (!match) fail('selection_invalid');
    const key = JSON.parse(match[1]);
    if (seen.has(key)) fail('selection_invalid');
    seen.add(key);
    index = pair.lastIndex;
    if (match[3] === '}') break;
  }
  if (index !== text.length || [...seen].sort().join(',') !== 'mergeTree,mode,schemaVersion,sourceSha,sourceTree,targetBaseSha') fail('selection_invalid');
  return value;
}

export function validateSourceOnlyPromotion(selection, c) {
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)
    || Object.keys(selection).sort().join(',') !== 'mergeTree,mode,schemaVersion,sourceSha,sourceTree,targetBaseSha'
    || selection.schemaVersion !== 1 || selection.mode !== 'thn-source-only') fail('selection_invalid');
  for (const key of ['sourceSha','sourceTree','targetBaseSha','mergeTree']) if (!shaPattern.test(selection[key] ?? '')) fail('selection_invalid');
  if (c.eventName !== 'push' || c.ref !== 'refs/heads/main' || !shaPattern.test(c.sha ?? '')
    || !Array.isArray(c.parents) || c.parents.length !== 2 || c.parents[0] !== selection.targetBaseSha
    || c.parents[1] !== selection.sourceSha || c.sourceSha !== selection.sourceSha || c.sourceTree !== selection.sourceTree
    || c.mergeTree !== selection.mergeTree || c.event?.before !== selection.targetBaseSha || c.event?.after !== c.sha
    || c.event?.forced !== false || c.event?.created !== false || c.event?.deleted !== false) fail('evidence_mismatch');
  return { sourceOnly: true };
}
function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  if (result.status !== 0) fail('git_evidence_unavailable');
  return result.stdout.trim();
}
async function main() {
  if (process.argv.length !== 2) fail('arguments_invalid');
  const eventName = process.env.GITHUB_EVENT_NAME;
  if (eventName === 'workflow_dispatch' || process.env.GITHUB_REF === 'refs/heads/test') {
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'source_only=false\n');
    return;
  }
  const repository = process.env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !process.env.GITHUB_TOKEN) fail('context_invalid');
  const selector = parseSourceOnlyPromotionSelection(process.env.PRODUCTION_PROMOTION_SELECTION_JSON);
  const response = await fetch(`https://api.github.com/repos/${repository}/git/ref/heads/test`, {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) fail('source_evidence_unavailable');
  const sourceSha = (await response.json()).object?.sha;
  if (!shaPattern.test(sourceSha ?? '')) fail('source_evidence_unavailable');
  const sha = process.env.GITHUB_SHA;
  if (!shaPattern.test(sha ?? '')) fail('context_invalid');
  const parents = git(['show','-s','--format=%P',sha]).split(' ');
  const sourceTree = git(['rev-parse',`${sourceSha}^{tree}`]);
  const mergeTree = git(['rev-parse',`${sha}^{tree}`]);
  if (parents.length !== 2 || git(['merge-tree','--write-tree',parents[0],sourceSha]) !== mergeTree) fail('native_merge_mismatch');
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  validateSourceOnlyPromotion(selector, { eventName, ref: process.env.GITHUB_REF, sha, parents, sourceSha, sourceTree, mergeTree, event });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, 'source_only=true\n');
  console.log('production_source_only_verified');
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch(error => { console.error(/^production_promotion_[a-z_]+$/.test(error.message) ? error.message : 'production_promotion_rejected'); process.exitCode = 1; });
}
