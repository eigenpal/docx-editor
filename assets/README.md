# Legacy assets path (npm compatibility)

Canonical location for repo image assets: [`.github/assets/`](../.github/assets/).

`header.png` and `editor.png` are duplicated here because already-published npm package READMEs (the ones indexed on npmjs.com at the time of the move) embed `https://raw.githubusercontent.com/eigenpal/docx-editor/main/assets/header.png`. Removing this path would break the image on every legacy npm package page.

Update both copies (`.github/assets/<name>.png` and `assets/<name>.png`) until no live npm version still points here.

**Delete this folder once `@eigenpal/docx-editor-react@1.0.3` (and the matching fixed-group siblings) ship to npm.** At that point the latest published READMEs already point at `.github/assets/`, and only pinned-old-version npm pages would still try to fetch from here. Acceptable to break those.
