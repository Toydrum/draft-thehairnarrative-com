# 2026-09-09 CT - Preserve approved design during Journal integration

- Reconcile the dev annotation restore with the later approved Narrative
  correction: lowercase centered title, spacing below the navbar, and no
  introductory hero paragraph. Do not restore the retired large heading.
- Preserve the other approved dev corrections and the isolated Journal/editor
  integration. No production branch or deployment configuration changes.
- Add three design regressions to the existing wildcard Node test suite. A
  read-only comparison with the old dev page fails all three; the reconciled
  candidate must pass before promotion.
- This is source reconciliation only. Publication and owner access remain
  separate TEST-only release and verification operations.
- Complete the connected package's closed server-only Journal descriptor.
  Rename the private login translation key to `passwordLabel`, preserving
  displayed text while keeping the existing credential-field validator strict.
- Add whole-package readiness, real descriptor and bilingual label regressions.
  All 24 tests and the 121-file validation-only deployment pass in three rounds.
  No shared validator, cloud permission or activation switch is changed.
