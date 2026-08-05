# Zoolanding Draft Workflow

Use this file as the mandatory local entrypoint. Start with this draft's README and `draft-repo.config.json`; open draft-local `ai_notes/README.md` only when it exists and the task needs that context.

## Task Routing

Read only the row needed for the current task, then inspect the executable JSON or workflow that owns the behavior.

| Task | Read |
| --- | --- |
| Edit draft content or routes | Local `site-config.json`, page JSON, and task-specific local docs |
| Create or bootstrap a draft | https://github.com/LynxPardelle/zoolandingpage/blob/main/ai-notes/how-to/create-secure-draft-repo.md |
| Promote, deploy, or configure branches | https://github.com/LynxPardelle/zoolandingpage/blob/main/docs/11-draft-lifecycle.md and local `.github/workflows/` |
| Upload public assets | https://github.com/LynxPardelle/zoolandingpage/blob/main/docs/12-public-assets-and-file-uploads.md |
| Configure domains or aliases | https://github.com/LynxPardelle/zoolandingpage/blob/main/docs/13-managed-alias-front-door.md |
| Work across repositories | https://github.com/LynxPardelle/zoolandingpage/blob/main/docs/repository-map.md |

Do not load the whole hub, local documentation tree, or changelog unless the routed document requires it.

## Git And Publication

- Work on `dev`; promote with separate pull requests `dev -> test -> main`.
- `dev` does not deploy. `test` deploys only the test environment after merge. `main` deploys production only after merge.
- Pull with `--ff-only` only when the worktree is clean. Report dirty, detached, or unexpected branch state before changing files.
- Treat this as an independent Git repository. Stage, commit, and push from this root.
- Do not bypass release guards, weaken OIDC, add long-lived cloud keys, or infer that another draft has the same aliases/domain policy.

## Public Safety

- Treat the repository as public unless current GitHub metadata proves otherwise.
- Never commit secrets, tokens, upload grants, API keys, signed URLs, raw env values, private customer data, PII, `.zlp/`, `.env*`, local logs, private source documents, credential files, local databases, or agent state.
- Keep `ai_notes/`, `findings/`, and `errors-reports/` local/ignored unless a sanitized reusable lesson is deliberately promoted to the hub.
- Public contact details are allowed only when intentionally client-facing. Source CVs, identity documents, private photos, raw research, and unapproved domains/aliases stay local.
- Before PR, merge, visibility changes, or publication, run the hub public-safety audit and resolve every blocking finding.

## Closeout

- Run repository guard/deploy tests and the hub preflight/public-safety checks relevant to the change.
- Audit, fix, and rerun at least three times.
- Payload, route, style, script, or rendered-behavior changes require desktop and mobile browser QA on every affected route. Documentation-only changes require link/workflow/public-safety validation.
- Record notable draft chronology in the owning changelog, not in this file or `Codex.md`.
