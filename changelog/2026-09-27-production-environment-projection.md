# Production draft environment projection

Date: 2026-09-27 (Central Time).

Prepared production publication configuration with an exact source-only promotion gate. The canonical source remains TEST; explicit production plan construction validates its closed binding and projects only the approved production origin, environment, service-binding ID and six private canonical URLs. All other source components, locale copy, routes, styles and assets remain unchanged.

The production credential job accepts the v2 descriptor only with the closed production values and rejects TEST bindings or required-origin drift before OIDC. Local draft tests and actual jq-filter checks passed. Production publication, prerequisite provisioning, owner enrollment and live acceptance have not occurred.

The raw source-only selector also rejects repeated JSON keys, including equivalent escaped key names, before requesting remote source evidence. Verified with real CLI execution and duplicate-coordinate regressions.

## Source-only TEST promotion

- Require `DRAFT_TEST_PROMOTION_SELECTION_JSON` for a push to TEST, using the same closed six-field native merge contract as production and the current DEV tip. Source-only promotions prepare no deployment plan and acquire no AWS credentials.
- Keep manual publication behind the existing exact merge provenance and protected Environment. Malformed, absent, duplicate or stale selections fail closed; production retains its separate selector.
- Exercise a real DEV-to-TEST Git merge preserving a TEST-only file, plus forced events, source drift and duplicate/absent selectors.
