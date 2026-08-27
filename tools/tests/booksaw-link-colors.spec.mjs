import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const draftRoot = new URL('../../', import.meta.url);
const readJson = relativePath => JSON.parse(readFileSync(new URL(relativePath, draftRoot), 'utf8'));
const site = readJson('site-config.json');
const files = [
  'components.json',
  ...new Set(site.routes.map(route => `${route.pageId}/components.json`)),
];
const links = files.flatMap(file => readJson(file).components
  .filter(component => component.type === 'link')
  .map(component => ({ file, component })));

// GenericLink's inherited-color fallback inspects the anchor's actual class
// attribute, not the utility names expanded inside an Angora combo.
for (const [combo, color] of [
  ['thnBooksawCtaLink', 'ank-color-linkColor'],
  ['thnBooksawNavLink', 'ank-color-textColor'],
]) {
  test(`${combo} anchors declare ${color} so their hover color is not inherited`, () => {
    const matchingLinks = links.filter(({ component }) =>
      String(component.config.classes ?? '').split(/\s+/).includes(combo));
    assert.ok(matchingLinks.length > 0, `No ${combo} links were inspected`);

    const missingExplicitColor = matchingLinks
      .filter(({ component }) => !component.config.classes.split(/\s+/).includes(color))
      .map(({ file, component }) => `${file}:${component.id}`);

    assert.deepEqual(missingExplicitColor, [],
      `${combo} requires an explicit anchor color; a combo-only color matches GenericLink's inheritance fallback`);
  });
}
