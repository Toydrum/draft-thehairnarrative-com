# Journal authoring

## Availability

The connected editor and public Journal are a locally verified candidate. This
document does not activate a private origin, account or publisher. TEST release,
owner enrollment and live acceptance are still required. The public website
does not expose an administrator navigation link.

## Owner workflow after activation

1. Open `/admin/journal` on the configured private origin. Sign in and complete
   the authenticator-app MFA challenge. Only the authorized owner can write.
2. Choose **New article**, then the article's language. English and Spanish are
   independent documents; neither is silently translated or published together.
3. Enter the title and short introduction, select one of the three editorial
   series, add a cover and its description, and write the body. The editor
   supports headings, lists, emphasis, quotations, links and inline images.
4. The working copy autosaves. **Save** and **Preview** are available explicitly.
   A working copy does not replace the public article until publication succeeds.
5. **Publish** publishes or updates the selected language. The URL is assigned
   from the title and reserved automatically; the owner never needs to type it.
   Once reserved, subsequent title changes do not break the link.
6. **Withdraw this language** asks for confirmation and preserves the working
   copy, URL reservation and other language. It can be published again.

Expired sessions require signing in again without discarding the open text.
Conflicting edits require explicit recovery; uncertain publication results keep
the same request identity so Retry cannot create a duplicate publication.
An accepted publication may still be waiting for cache refresh.

## Public behavior

- Home shows the latest three published articles in the selected language; the
  approved in-preparation cards remain when there are none.
- Journal lists all published articles. The three series have localized routes
  and an empty state even before their first article.
- Detail pages retain the Booksaw shell, focal 4:3 cover, readable body and
  localized metadata. There are no public tags, comments or author widgets.
- Missing/unpublished translations are not borrowed. Language switching goes
  to the published counterpart, or to Journal if none exists. Unknown routes
  return 404. Search, sitemap and public media expose only public delivery data.

No credentials, private session values or operational account identifiers should
be added to this document.
