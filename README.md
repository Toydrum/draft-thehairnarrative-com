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
- Protected promotion path: `dev -> test -> main`
- Shared test preview after the `dev -> test` promotion: https://test.zoolandingpage.com.mx/?draftDomain=thehairnarrative.com

The shared test host is the client-review surface for this phase. Production publication and DNS cutover remain separate decisions.
