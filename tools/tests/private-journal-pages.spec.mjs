import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>JSON.parse(readFileSync(new URL('../../'+p,import.meta.url),'utf8'));
const pages=['admin-journal-access','admin-journal-mfa','admin-journal','admin-journal-new','admin-journal-edit','admin-journal-preview'];
test('six opt-in private pages use shared primitives, two languages and no URL authoring',()=>{
 const site=read('site-config.json');
 assert.equal(site.runtime.authRemote.requiredOrigin,'https://admin-test.thehairnarrative.com');
 for(const id of pages){
  assert.equal(site.routes.find(r=>r.pageId===id)?.auth?.required,true,id);
  const page=read(id+'/page-config.json'),components=read(id+'/components.json').components;
  const ids=new Set(components.map(c=>c.id));page.rootIds.forEach(root=>assert.ok(ids.has(root)));
  for(const lang of ['en','es']) assert.ok(read(id+'/i18n/'+lang+'.json').dictionary.desk.title);
  assert.equal(read(id+'/variables.json').variables.journalDeskConfig.template,'fixed-article-v2');
  assert.ok(!components.some(c=>['slug','url','permalink'].includes(c.config?.fieldId)));
  assert.ok(components.every(c=>!c.type.startsWith('thn-')));
  assert.ok(site.sitemap.excludePaths.includes(site.routes.find(r=>r.pageId===id).path));
 }
});
