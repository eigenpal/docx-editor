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

## 3. The rail's presentation

- [x] 3.1 `editor/review-pane-layout.ts` in core: `REVIEW_RAIL_DOCK_MIN_PX`, `reviewPaneLayoutFor`.
- [x] 3.2 `DocxEditorViewport` measures itself, publishes `data-review-layout` and `ReviewLayoutContext`.
- [x] 3.3 `navigation-geometry.ts`: `docked` input; `useNavigationPane` passes it when the snapshot reports a fit.
- [x] 3.4 `pro/react/ReviewDrawer.tsx`: scrim, dialog semantics, Escape, focus in and back, hidden + inert when closed.
- [x] 3.5 `DocxEditorReview` reads the layout, renders the drawer, adds `flow` to `ReviewList`, drops the markers in a drawer.
- [x] 3.6 CSS: zeroed gutter in drawer layout, drawer + scrim + head + body, flow list.
- [x] 3.7 Tests: `react/test/fit-to-viewport.test.tsx` and `pro/src/__tests__/review-drawer.test.tsx`.

## 4. Housekeeping

- [x] 4.1 i18n: `zoom.automatic`, `zoom.fitWidth`, `review.close`; `i18n:fix` across locales.
- [x] 4.2 Extractions to stay under the max-lines caps: `docx-editor-zoom.ts` out of `docx-editor.ts`, `review-rail-geometry.ts` out of `DocxEditorReview.tsx`.
- [x] 4.3 `check-editor-contract.mjs`: `zoomMode` staged as a React-only prop with its closing condition.
- [x] 4.4 API snapshots re-extracted; docs page; changeset.
