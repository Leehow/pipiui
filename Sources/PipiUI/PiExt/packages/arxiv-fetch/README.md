# pipiui-arxiv-fetch

Official PipiUI local Pi package for `arxiv_fetch` (`0.1.0`, Apache-2.0).

It is copied unchanged to PipiUI's local Pi host and loaded with `-e`; it has no runtime npm install or third-party XML dependency. Use it for `arxiv.org`, `export.arxiv.org`, and `ar5iv.labs.arxiv.org` paper URLs. Use `github_fetch` for GitHub code URLs and `web_fetch` for all other sites.

The package queries the Atom API, then uses official arXiv HTML, ar5iv as one fallback, and only local `PIPIUI_PDF_HELPER` PDF extraction when available. PDFs are never uploaded.
