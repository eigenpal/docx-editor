# Drawings fixture manifest

18 inputs: 7 Word-authored repository fixtures and 11 deterministic builder outputs.

Regenerate focused fixtures:

```bash
bun e2e/fixtures/build-drawing-fixtures.mjs
```

## Evidence status

- **9.5 Word visual comparison:** blocked — Microsoft Word desktop not available in CI/dev; `screenshots/typed-drawings-word-comparison/` holds editor output only, labeled NOT Word reference.
- **3.4 / 6.8a:** unchecked without Word evidence.
- **7.9 comprehensive empty srcRect:** all eleven `a:srcRect` elements in `comprehensive-word-element-test.docx` are empty — not crop coverage.
- **7.1 list-pagination:** 27 `TargetMode="External"` image relationships; zero network fetch oracle.

## Entries

| File                                      | Source                                                                                 | SHA-256             | Branch / refusal                                           | Word evidence                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ------------------- | ---------------------------------------------------------- | ---------------------------------------------- |
| comprehensive-word-element-test.docx      | Word-authored                                                                          | `d2db0c9423d69d52…` | canonical tree / none for supported drawings               | pending — editor-only baseline captured Task 0 |
| list-pagination-break.docx                | Word-authored                                                                          | `a4581c20871339e4…` | external rel refusal / external image — no fetch           | n/a — security oracle                          |
| float-wrap-comprehensive-test.docx        | Word-authored                                                                          | `276eff8171685aab…` | polygon/bbox exclusion / none                              | pending (9.5)                                  |
| image-layout-modes-demo.docx              | Word-authored                                                                          | `598ae22b400ce2e1…` | authoring chrome / none                                    | pending (9.5)                                  |
| issue-705-anchored-header-letterhead.docx | Word-authored                                                                          | `a98dbe5afd96bba8…` | HF furniture / none                                        | pending (9.5)                                  |
| wrap-none-positioned-image-demo.docx      | Word-authored                                                                          | `4ae338400267ef24…` | layer order / none                                         | pending (9.5)                                  |
| footer-textbox-page-fields.docx           | Word-authored, sanitized (length-preserving text scramble, neutral metadata and media) | `f10deb8c12cc325d…` | textbox story layout / cached field text never painted     | pending (9.5)                                  |
| images-external.docx                      | deterministic builder                                                                  | `d9a81f2c66c3a237…` | external/missing/spoof/unrenderable / zero fetch           | not applicable — synthetic OPC                 |
| images-wrap-sides.docx                    | deterministic builder                                                                  | `c10acd51efa93ab4…` | nine wrap modes / layout records per wrap                  | not applicable — synthetic OPC                 |
| images-crop.docx                          | deterministic builder                                                                  | `6ec351c1b99133ad…` | inline crop / crop permille preserved                      | not applicable — synthetic OPC                 |
| images-zorder.docx                        | deterministic builder                                                                  | `bdf3931fe99def4f…` | two overlapping anchors / layer metadata                   | not applicable — synthetic OPC                 |
| images-formats.docx                       | deterministic builder                                                                  | `1459468b6726c3d3…` | seven inline drawings / ready vs placeholder               | not applicable — synthetic OPC                 |
| images-tiff.docx                          | deterministic builder                                                                  | `0439dbcea6f9e650…` | three inline drawings / converted raster vs placeholder    | not applicable — synthetic OPC                 |
| images-header.docx                        | deterministic builder                                                                  | `6f8c21cc81369919…` | HF furniture anchor / header flow height unchanged         | not applicable — synthetic OPC                 |
| images-nonpicture.docx                    | deterministic builder                                                                  | `22599a1d9ba7bc33…` | extent placeholders / non-picture refusal                  | not applicable — synthetic OPC                 |
| images-transform.docx                     | deterministic builder                                                                  | `313237fe1ef34828…` | three inline drawings / transform paint metadata           | not applicable — synthetic OPC                 |
| images-compatibility-malformed.docx       | deterministic builder                                                                  | `9a8582879a75fae3…` | demotion/generic preservation / inert unsupported payloads | not applicable — synthetic OPC                 |
| images-drawingml-watermark.docx           | deterministic builder                                                                  | `3b41aa8cad33a27e…` | centered watermark anchor / watermark effects paint        | not applicable — synthetic OPC                 |

<!-- DRAWINGS_FIXTURE_MANIFEST
{
  "version": 1,
  "entries": [
    {
      "file": "comprehensive-word-element-test.docx",
      "source": "Word-authored",
      "version": "Microsoft Word (repository fixture)",
      "features": [
        "inline layout",
        "square wrap sample",
        "eleven drawings",
        "empty a:srcRect on all pictures"
      ],
      "geometry": "mixed inline/anchor; see fixture labels",
      "branch": "canonical tree",
      "refusal": "none for supported drawings",
      "wordEvidence": "pending — editor-only baseline captured Task 0",
      "tolerance": "n/a until Word screenshots (9.5)",
      "sha256": "d2db0c9423d69d52128a09ce816f4b5e1fd9de72b019e1c225b07d7d8f51cbf3"
    },
    {
      "file": "list-pagination-break.docx",
      "source": "Word-authored",
      "version": "Microsoft Word (repository fixture)",
      "features": [
        "27 TargetMode=External image relationships",
        "list pagination",
        "zero-fetch rule"
      ],
      "geometry": "multi-page body lists",
      "branch": "external rel refusal",
      "refusal": "external image — no fetch",
      "wordEvidence": "n/a — security oracle",
      "tolerance": "zero network requests",
      "sha256": "a4581c20871339e4d364b7b1c8770d8b0a106d94d16f85599d05738b7fbe9c29"
    },
    {
      "file": "float-wrap-comprehensive-test.docx",
      "source": "Word-authored",
      "version": "Microsoft Word (repository fixture)",
      "features": [
        "wrapTight",
        "wrapThrough",
        "wrapTopAndBottom"
      ],
      "geometry": "multiple anchored wraps",
      "branch": "polygon/bbox exclusion",
      "refusal": "none",
      "wordEvidence": "pending (9.5)",
      "tolerance": "pending Word comparison",
      "sha256": "276eff8171685aabeec864ea8530c34ccee66fefefa9bad7b7ac2b49e962084a"
    },
    {
      "file": "image-layout-modes-demo.docx",
      "source": "Word-authored",
      "version": "Microsoft Word (repository fixture)",
      "features": [
        "inline",
        "square wrap",
        "top-and-bottom",
        "Playwright acceptance target"
      ],
      "geometry": "six drawings on one page",
      "branch": "authoring chrome",
      "refusal": "none",
      "wordEvidence": "pending (9.5)",
      "tolerance": "browser acceptance only",
      "sha256": "598ae22b400ce2e1381f73a1899aa9872690101163d012e19cde21c4c8f092bb"
    },
    {
      "file": "issue-705-anchored-header-letterhead.docx",
      "source": "Word-authored",
      "version": "Microsoft Word (repository fixture)",
      "features": [
        "page-relative header anchor",
        "header flow-height rule"
      ],
      "geometry": "header letterhead anchor",
      "branch": "HF furniture",
      "refusal": "none",
      "wordEvidence": "pending (9.5)",
      "tolerance": "pending Word comparison",
      "sha256": "a98dbe5afd96bba8e215b2565f534b3b087dcbbaf67b855eca4bfa650ba7c474"
    },
    {
      "file": "wrap-none-positioned-image-demo.docx",
      "source": "Word-authored",
      "version": "Microsoft Word (repository fixture)",
      "features": [
        "wrapNone",
        "behindDoc positioning"
      ],
      "geometry": "positioned wrap-none seals",
      "branch": "layer order",
      "refusal": "none",
      "wordEvidence": "pending (9.5)",
      "tolerance": "pending Word comparison",
      "sha256": "4ae338400267ef2407d0017b717dcce60d55204358370b5a2c2e94d110caf8dd"
    },
    {
      "file": "footer-textbox-page-fields.docx",
      "source": "Word-authored, sanitized (length-preserving text scramble, neutral metadata and media)",
      "version": "Microsoft Word (repository fixture)",
      "features": [
        "42 sections",
        "anchored page-positioned footer textboxes",
        "PAGE and NUMPAGES fields inside textbox stories",
        "stale cached field results",
        "mc:AlternateContent wps/VML pairs"
      ],
      "geometry": "A4; page-relative posOffset anchors in footers 1, 2 and 4",
      "branch": "textbox story layout",
      "refusal": "cached field text never painted",
      "wordEvidence": "pending (9.5)",
      "tolerance": "fingerprint + digest equality",
      "sha256": "f10deb8c12cc325de75b509e0fa135e996a8b9ca935ea21d874dc6a2056acddd"
    },
    {
      "file": "images-external.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "r:link",
        "unsafe scheme",
        "MIME spoof",
        "oversize extent"
      ],
      "geometry": "see builder",
      "branch": "external/missing/spoof/unrenderable",
      "refusal": "zero fetch",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "d9a81f2c66c3a2371f17d3ed02d60cd4873a2b68be9e8f126c95f4c3c1447a50"
    },
    {
      "file": "images-wrap-sides.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "all ST_WrapText sides",
        "wrapNone front/behind"
      ],
      "geometry": "see builder",
      "branch": "nine wrap modes",
      "refusal": "layout records per wrap",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "c10acd51efa93ab47fbaa4e4e3a9d11aec8b060975d70d44a84c4e6c082312ad"
    },
    {
      "file": "images-crop.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "non-empty a:srcRect"
      ],
      "geometry": "see builder",
      "branch": "inline crop",
      "refusal": "crop permille preserved",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "6ec351c1b99133ad83c959830b486c509de5400cc0839f1d5a7181b9940eb833"
    },
    {
      "file": "images-zorder.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "relativeHeight",
        "behindDoc",
        "allowOverlap=0"
      ],
      "geometry": "see builder",
      "branch": "two overlapping anchors",
      "refusal": "layer metadata",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "bdf3931fe99def4f1b9ffbbf6c4edb492f42e09767c3484f52340b1f65758de2"
    },
    {
      "file": "images-formats.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "PNG/JPEG/GIF/SVG/TIFF/EMF/WMF"
      ],
      "geometry": "see builder",
      "branch": "seven inline drawings",
      "refusal": "ready vs placeholder",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "1459468b6726c3d352a49131daa2a56620e91c49da4733de4940c572ff8b75e1"
    },
    {
      "file": "images-tiff.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "baseline RGB TIFF",
        "both byte orders",
        "truncated"
      ],
      "geometry": "see builder",
      "branch": "three inline drawings",
      "refusal": "converted raster vs placeholder",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "0439dbcea6f9e650fd3a810aaced55a75ff77c23009b8a2ad026c8c193496973"
    },
    {
      "file": "images-header.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "page-relative header anchor"
      ],
      "geometry": "see builder",
      "branch": "HF furniture anchor",
      "refusal": "header flow height unchanged",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "6f8c21cc81369919ffefc48a537f9c64638f8e926afb931c7cc206f78d866b1f"
    },
    {
      "file": "images-nonpicture.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "chart",
        "group",
        "textbox"
      ],
      "geometry": "see builder",
      "branch": "extent placeholders",
      "refusal": "non-picture refusal",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "22599a1d9ba7bc33210a065a1755374f25c33b67da3c49f59893ca7bf0406be5"
    },
    {
      "file": "images-transform.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "rotation",
        "flipH",
        "flipV"
      ],
      "geometry": "see builder",
      "branch": "three inline drawings",
      "refusal": "transform paint metadata",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "313237fe1ef34828465c0ed234c0df309455473df24e28db1857a910bc44c605"
    },
    {
      "file": "images-compatibility-malformed.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "malformed anchor",
        "mc:AlternateContent",
        "VML",
        "OLE",
        "altChunk"
      ],
      "geometry": "see builder",
      "branch": "demotion/generic preservation",
      "refusal": "inert unsupported payloads",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "9a8582879a75fae3fc2051925376550ce2c2448100b13eae32a201958894d7ff"
    },
    {
      "file": "images-drawingml-watermark.docx",
      "source": "deterministic builder",
      "version": "build-drawing-fixtures.mjs @ 2026-01-01",
      "features": [
        "a:lum",
        "a:grayscl",
        "behindDoc"
      ],
      "geometry": "see builder",
      "branch": "centered watermark anchor",
      "refusal": "watermark effects paint",
      "wordEvidence": "not applicable — synthetic OPC",
      "tolerance": "fingerprint + digest equality",
      "sha256": "3b41aa8cad33a27e5960b5feaeaeb1dec9a257fa373bcfb9edf4741f0552cd62"
    }
  ]
}
-->
