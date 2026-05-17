# Vue Un-Stub Closure Checklist

Issue #439 can close as complete only after the Vue editor un-stub gate is satisfied.
This checklist turns the broad audit into the acceptance criteria for the final
un-stub PR.

## Required Before Closing #439

- [x] Every **editor** row in `specs/vue-react-parity/spec.md` is `done` or
      `omitted-v1` with a documented follow-up issue. No editor row remains
      `partial` or `missing`.
- [x] The Vue package description in `packages/vue/package.json` no longer
      starts with `[STUB]`.
- [x] `scripts/check-export-parity.mjs` runs with strict named-export parity, or
      every remaining public export divergence is documented in
      `notes/intentional-export-divergence.md`.
- [x] Vue `DocxEditorRef` exposes the editor-scope methods required by
      `EditorRefLike`, or omissions are explicitly documented in
      `notes/api-divergence.md` with follow-up issues.
- [x] Vue-only and cross-adapter parity tests cover every editor matrix row.
- [x] `notes/qa-signoff.md` records the local Chromium visual pass and the
      preview evidence still required for PR review.
- [x] QA sign-off documents the local Chromium pass and records
      Firefox/WebKit, keyboard-only navigation, and preview screenshots as
      reproducible PR-review evidence.
- [x] Performance budget scripts exist for cold start, input latency, save, and
      scroll FPS; local verification passes and writes ignored artifacts by default.
- [x] A fresh consumer app can install the packed Vue package and mount the
      editor with only `@eigenpal/docx-editor-vue` for basic usage. Direct core or
      i18n imports are verified in a separate explicit-dependency variant.
- [x] Vue README, root README, demo banner, and changesets no longer describe
      the Vue editor as a stub.
- [x] The final un-stub PR should link the test evidence, preview visual QA
      artifacts, performance output when captured with `PERF_WRITE_ARTIFACTS=1`,
      and any `omitted-v1` follow-up issues.

## Follow-Up Issue Ownership

- Third-party Vue plugin API remains tracked by #367 unless it is promoted into
  v1 scope.
- Vue agent SDK parity remains tracked by #368 unless the final un-stub PR also
  removes any agent-side readiness marker.
- Any editor row marked `omitted-v1` must have its own focused follow-up issue
  before #439 closes.
