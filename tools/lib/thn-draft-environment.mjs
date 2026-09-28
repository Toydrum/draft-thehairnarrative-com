/** Project a verified source package into distinct deployment metadata; never modify source. */
export function projectThnDraftEnvironment({ domain, environment, files }) {
  if (!['test','production'].includes(environment)) throw new Error('thn_draft_projection_rejected');
  if (domain !== 'thehairnarrative.com' || environment === 'test') return files;
  const sitePath = `${domain}/site-config.json`, bindingPath = `${domain}/server/protected-feature-bindings-v2.json`;
  const sites = files.filter(f => f.path === sitePath), bindings = files.filter(f => f.path === bindingPath);
  if (!bindings.length && sites.length === 1 && sites[0].content?.runtime?.authRemote?.authProfileId !== 'journal-owner') return files;
  const expected = { bindingId:'journal-v2',domain,environment:'test',authProfileId:'journal-owner',featureId:'journal',
    hubId:'thehairnarrative-com-journal',serviceBindingId:'thn-journal-test-v2',authBasePath:'/auth-v2',contentHubBasePath:'/features/content-hub-v2',status:'active' };
  const source = bindings[0]?.content;
  if (sites.length !== 1 || bindings.length !== 1 || sites[0].content?.domain !== domain
    || sites[0].content?.runtime?.authRemote?.authProfileId !== 'journal-owner'
    || sites[0].content?.runtime?.authRemote?.requiredOrigin !== 'https://admin-test.thehairnarrative.com'
    || !source || Object.keys(source).sort().join(',') !== Object.keys(expected).sort().join(',')
    || Object.keys(expected).some(key => source[key] !== expected[key])) throw new Error('thn_draft_projection_rejected');
  const projected = structuredClone(files);
  const privatePages = {'admin-journal':'/admin/journal','admin-journal-access':'/admin/journal/access',
    'admin-journal-mfa':'/admin/journal/mfa','admin-journal-new':'/admin/journal/new',
    'admin-journal-edit':'/admin/journal/:articleId/edit','admin-journal-preview':'/admin/journal/:articleId/preview'};
  for (const [pageId, pagePath] of Object.entries(privatePages)) {
    const configs=projected.filter(f=>f.path===`${domain}/${pageId}/page-config.json`);
    if (configs.length > 1) throw new Error('thn_draft_projection_rejected');
    const config=configs[0]?.content;
    if (!config) continue;
    if (config.domain!==domain || config.pageId!==pageId || config.seo?.canonical!==`https://admin-test.thehairnarrative.com${pagePath}`) throw new Error('thn_draft_projection_rejected');
    config.seo.canonical=`https://admin.thehairnarrative.com${pagePath}`;
  }
  projected.find(f => f.path === sitePath).content.runtime.authRemote.requiredOrigin = 'https://admin.thehairnarrative.com';
  const binding = projected.find(f => f.path === bindingPath).content;
  binding.environment = 'production'; binding.serviceBindingId = 'thn-journal-production-v2';
  return projected;
}
