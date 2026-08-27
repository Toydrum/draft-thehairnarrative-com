# Approved typography assets

These four WOFF2 files reproduce the Newsreader / Open Sans pairing used in the approved Hair Narrative prototypes. They are official Google Fonts Latin-subset files, downloaded unchanged on 2026-08-27 (Central Time), not fonts extracted from the commercial Booksaw archive. That archive supplies Icomoon binaries and declares different text families.

| Family | Weight | Style | File | Bytes |
| --- | --- | --- | --- | ---: |
| Newsreader | 400 | normal | `newsreader-latin-400-normal.woff2` | 57,268 |
| Newsreader | 500 | normal | `newsreader-latin-500-normal.woff2` | 60,724 |
| Open Sans | 400 | normal | `open-sans-latin-400-normal.woff2` | 18,640 |
| Open Sans | 600 | normal | `open-sans-latin-600-normal.woff2` | 18,620 |

Total: 155,252 bytes, 25,068 bytes less than the equivalent two weight-variable provider files. Both Newsreader faces retain the `opsz` axis from 6 to 72; their actual binary default is 18. Use automatic optical sizing, not a fixed optical-size override. No italic face is needed by the approved prototypes. Latin includes the accented letters and punctuation used for English and Spanish; no text-specific subset was generated.

The `runtimeSrc` entries in [font-manifest.txt](./font-manifest.txt) record historical local source paths. Current runtime descriptors in [site-config.json](../../site-config.json) use `/assets/thehairnarrative.com/booksaw-20260827/fonts/`. Those same-origin binaries are packaged in the shared runtime's versioned public asset set, independently of this draft's JSON deployment. Verify the active test artifact's public manifest, MIME types, and bytes before promoting the payload; preparation alone is not deployment.

The JSON-formatted provenance uses a `.txt` extension so the strict draft JSON collector does not mistake it for a configuration payload. Register each actual weight explicitly; do not synthesize the 500/600 faces. The manifest retains the exact provider URLs, byte sizes, SHA-256 hashes, and separate intact licenses. Runtime descriptors use no queries, tokens, remote stylesheets, or external font requests.

## License and provenance

Newsreader is copyrighted by The Newsreader Project Authors and distributed under [SIL Open Font License 1.1](./Newsreader-OFL.txt). Open Sans is copyrighted by The Open Sans Project Authors and distributed under [SIL Open Font License 1.1](./OpenSans-OFL.txt). Retain the corresponding copyright and full license with redistribution; the fonts themselves remain under OFL. The local `.gitattributes` preserves upstream license bytes during Git checkout. These font licenses are independent of the purchased Booksaw template license.

Primary sources: [Newsreader family and upstream metadata](https://github.com/google/fonts/tree/main/ofl/newsreader), [Open Sans family and upstream metadata](https://github.com/google/fonts/tree/main/ofl/opensans), [Google Fonts CSS API](https://developers.google.com/fonts/docs/css2). This is asset provenance, not a substitute for reviewing third-party licensing before publication.
