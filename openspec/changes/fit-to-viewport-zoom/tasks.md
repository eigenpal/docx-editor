# Tasks

## 1. The fit (engine)

- [x] 1.1 `contracts/editor.ts`: `ZoomFitTarget`, `ZoomMode`, `Editor.getZoomMode`/`setZoomMode`, `EditorSnapshot.zoomMode`.
- [x] 1.2 `editor/zoom-fit.ts`: `fitZoom` with whole-percent floor, contract and mode clamps, null on a degenerate measurement; `AUTO_ZOOM_MODE`, `FIXED_ZOOM_MODE`, `FIT_GUTTER_PX`, `resolveZoomMode`, `isFitMode`.
- [x] 1.3 `editor/zoom-controller.ts`: scroller lookup, content-box measurement (physical paddings), `ResizeObserver` coalesced to one frame, no-op when the answer is unchanged.
- [x] 1.4 `editor/docx-editor-zoom.ts`: the lane holding scale + mode, one apply path that rescales / bumps / emits, `setZoom` leaving a fit, `setZoomMode` refusing an unknown mode.
- [x] 1.5 Wire into `docx-editor.ts`: default from `config.zoom`/`config.zoomMode`, attach after mount, detach on detach/destroy, refit on `setPageSetup`, both members on the facade, `zoomMode` in the snapshot.
- [x] 1.6 `docx-editor-support.ts`: `zoomMode` in `snapshotsEqual`.
- [x] 1.7 `styles/editor.css`: `scrollbar-gutter: stable` on the viewport.
- [x] 1.8 Tests: `zoom-fit.test.ts` (rounding direction, clamps, auto cap, null, gutter) and `zoom-controller.test.ts` (mount-time fit, resize, gutter reservation, published refit, deadband, leaving and re-entering the fit, detach/destroy).

## 2. The zoom lifecycle (React)

- [x] 2.1 `editor/useZoom.ts`, over `useEditorState` and the existing `ZOOM_LEVELS` ladder.
- [x] 2.2 `zoomMode` on `DocxEditorRootProps`, forwarded into the config and re-applied in the same effect as `zoom` (mode after level).
- [x] 2.3 `zoomMode` on `DocxEditorProps`, threaded through the `<DocxEditor>` sugar.
- [x] 2.4 Toolbar zoom menu: Automatic and Fit width above the levels, ticked from the mode, `data-fit` on the part.
- [x] 2.5 `useZoom` and `UseZoomResult` exported; export-divergence note updated.

## 3. Keeping the two panes honest

- [x] 3.1 `AUTO_ZOOM_FLOOR`, so a fit stops before the page stops being readable and the container scrolls instead.
- [x] 3.2 `navigation-geometry.ts`: `docked` input for a fit whose page width follows the padding; `useNavigationPane` passes it only when the fit is BINDING, not merely selected.
- [x] 3.3 The review rail is untouched: it reserves its gutter at every width, exactly as before.

## 4. Housekeeping

- [x] 4.1 i18n: `zoom.automatic`, `zoom.fitWidth`; `i18n:fix` across locales.
- [x] 4.2 `docx-editor-zoom.ts` extracted out of `docx-editor.ts`, which was at its max-lines cap.
- [x] 4.3 `check-editor-contract.mjs`: `zoomMode` staged as a React-only prop with its closing condition.
- [x] 4.4 API snapshots re-extracted; docs page; changeset.
