# pipiui-arxiv-fetch

Official PipiUI local Pi package for `arxiv_fetch` (`0.1.0`, Apache-2.0).

It is copied unchanged to PipiUI's local Pi host and loaded with `-e`; it has no runtime npm install or third-party XML dependency. Use it for `arxiv.org`, `export.arxiv.org`, and `ar5iv.labs.arxiv.org` paper URLs. Use `fetch_content` for all other sites.

The package queries the Atom API, then uses official arXiv HTML and ar5iv as one fallback. PDF content is handled by pi-web-access's `fetch_content` when that extension is mounted.
