# Zoolanding Draft Repository

This repository owns one sanitized Zoolanding draft package.

## Start Here

- AI and contributor routing: [AGENTS.md](AGENTS.md)
- Verified domain, branches, environments, and required variables: [draft-repo.config.json](draft-repo.config.json)
- Draft routes and payload: `site-config.json` and task-specific page JSON
- Deployment implementation: [.github/workflows/](.github/workflows/) and [tools/deploy-draft.mjs](tools/deploy-draft.mjs)
- Shared authoring, safety, release, asset, and alias guidance: [Zoolandingpage documentation hub](https://github.com/LynxPardelle/zoolandingpage/blob/main/docs/README.md)

Read only the task-specific route in `AGENTS.md`; do not duplicate shared hub procedures here.

## Repository And Test Preview

- Public repository: https://github.com/Toydrum/draft-thehairnarrative-com
- Promotion path: `dev -> test -> main`, with separate reviewed pull requests.
- Shared test preview after the `dev -> test` promotion: https://test.zoolandingpage.com.mx/?draftDomain=thehairnarrative.com

The shared test host remains the review surface. A production push requires the exact `DRAFT_PRODUCTION_PROMOTION_SELECTION_JSON` source-only selector and performs no credential-bearing publication. The separately authorized manual production workflow retains exact merge provenance, complete plan/digest verification and the protected production Environment.

## Booksaw Design Migration

The source implements the approved Booksaw composition across thirteen public route patterns and six private routes using generic Zoolandingpage components and draft-owned `thnBooksaw*` Angora combos. Home keeps Narrative, Journal, Letter, Practice, and Bridal Narrative in that order; Letter is a Home section, not another route.

The source copies of the approved images and Newsreader/Open Sans faces remain under `assets/booksaw/` and `assets/fonts/`. Runtime payloads reference the versioned same-origin public paths `/assets/thehairnarrative.com/booksaw-20260827/images/` and `/assets/thehairnarrative.com/booksaw-20260827/fonts/`. These binaries are packaged separately in the shared runtime's immutable browser artifact; the JSON deployment does not upload them.

The shared-runtime release adds declarative font loading, portalled-menu keyboard handling, and container language attributes while retaining existing focus semantics. Activate and verify that runtime and all referenced assets in **test before promoting this payload**. Preparation alone does not mean this revision is deployed. Responsive and interactive checks cover the approved routes; a physical-keyboard Tab/Shift+Tab check remains pending because the review automation did not establish the browser's native default traversal.

CTA and desktop navigation anchors include explicit base-color utilities alongside their Angora combos so GenericLink's inherited-color fallback does not override hover contrast. Run `node --test tools/tests/booksaw-link-colors.spec.mjs` to check this authoring constraint.

Newsletter automation, article publication, reservations and payments are separate operations. Production package publication and DNS activation require their reviewed release inventories.

## Isolated Journal Delivery Preparation

The connected Journal package includes the closed `server/protected-feature-bindings-v2.json` descriptor. The TEST workflow validates it and requires the exact dedicated admin origin. Its kind remains server-only; it must never enter the public browser projection. The descriptor contains logical routing coordinates only, not deployment resource identifiers or credentials. Publishing this descriptor does not provision an owner or enable the separate registry, authentication and writer controls. Existing payloads without the binding remain valid. Zoosite and other draft repositories are not changed.

The source descriptor remains bound to TEST. An explicit production plan validates that source, projects only the production required origin, service binding, environment and six private canonical URLs, then validates the separate closed production schema. Components, routes, locale copy, styles and source assets are preserved. Production uses `admin.thehairnarrative.com`, public `thehairnarrative.com` and `thn-journal-production-v2`; it never imports TEST accounts or article data.

The credential-bearing job consumes the previously validated plan, never checks out or executes draft code, and verifies the backend's published domain/environment/version before recording rollback coordinates. The plan artifact retention request is 90 days, subject to repository limits. Preserve the successful run summary's exact artifact ID, full source SHA, validation attempt, version ID, and external manifest SHA-256 for the rollback window.

For a separately authorized TEST rollback, download the recorded artifact by its numeric ID and fetch the original successful, attempt-specific run and artifact metadata from this repository. Set `ROLLBACK_PLAN_PATH`, `ROLLBACK_MANIFEST_PATH`, `ROLLBACK_RUN_METADATA_PATH`, `ROLLBACK_ARTIFACT_METADATA_PATH`, `ROLLBACK_MANIFEST_SHA256`, and `ROLLBACK_ARTIFACT_ID` from that retained evidence, then run:

```powershell
node tools/prepare-journal-rollback.mjs
```

This read-only selector returns `activationAllowed:false` and the already stored immutable `versionId`. A separately authorized operator uses Config Authoring `publishDraft` for that version; do not rebuild or `upsertDraft` to approximate rollback. Missing/expired artifacts, another repository or branch, failed runs, and inconsistent attempts are rejected. Partial job retries that reuse an earlier validation attempt require separate owner verification of the successful publication evidence; the selector does not infer success for a failed attempt.

The connected private editor and public Journal are now implemented and tested
locally. Read [Journal authoring](docs/journal-authoring.md) for the owner flow
and delivery behavior. Production identity provisioning, exact artifact selection,
protected-origin activation, owner enrollment and live acceptance remain release
gates. Source-only promotion does not enable the production blog.
