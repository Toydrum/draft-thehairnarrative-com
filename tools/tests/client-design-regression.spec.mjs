import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
// A read-only comparison against the integration base reproduces the regression.
// Normal CI always checks the working tree, not a historical reference.
const sourceRef = process.env.THN_CLIENT_DESIGN_REF;
assert.ok(!sourceRef || sourceRef === 'origin/dev', 'Unsupported comparison ref');
const source = sourceRef
  ? execFileSync('git', ['-c', `safe.directory=${root.replace(/[\\/]$/, '')}`,
    'show', `${sourceRef}:the-narrative/components.json`], { cwd: root, encoding: 'utf8' })
  : readFileSync(new URL('../../the-narrative/components.json', import.meta.url), 'utf8');
const components = new Map(JSON.parse(source).components.map(item => [item.id, item]));

test('Narrative keeps its approved lowercase, centered section title', () => {
  const title = components.get('heroTitle');
  assert.equal(title.config.text, 'the narrative');
  assert.equal(title.valueInstructions, undefined);
  assert.match(title.config.classes, /\bthnBooksawSectionTitle\b/);
  assert.match(title.config.classes, /\bank-textAlign-center\b/);
});

test('Narrative does not restore the removed introductory copy', () => {
  assert.deepEqual(components.get('heroContent').config.components, ['heroTitle']);
});

test('Narrative retains space below the navbar and stacks title above its image', () => {
  assert.match(components.get('heroSection').config.classes, /\bank-paddingBlock-64px\b/);
  assert.match(components.get('heroFrame').config.classes, /\bank-flexDirection-column\b/);
  assert.deepEqual(components.get('heroFrame').config.components, ['heroContent', 'heroVisualLayout']);
});
