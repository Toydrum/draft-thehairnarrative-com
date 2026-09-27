# Journal creation failure guard

Date: 2026-09-26 (Central Time)

The TEST QA rehearsal showed that a rejected `createArticle` left the `/admin/journal/new` writing controls visible. Text entered there could not be saved because no article identity existed, and the editor reset it. The new route now renders its toolbar and fields only after the server acknowledges an article ID. Its English and Spanish error copy directs the author back to the article list to retry creation.

This changes only the private new-article draft route. It does not alter the editor transport, saved drafts, account permissions, writer mode, publication, or public routes. The focused Journal contract test was observed failing before the change and passing afterward. Full local Journal tests retain two unrelated environment failures: the Windows path collection does not find the server descriptor in that assertion, and `jq` is unavailable locally.

The article list also replaces its obsolete assertion that publication is disabled. It now explains the explicit Publish action and preview step in both languages. The list-copy contract test failed before this correction and passed afterward.
