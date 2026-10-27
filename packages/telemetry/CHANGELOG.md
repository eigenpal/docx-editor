# @docx-editor.dev/telemetry

## 2.33.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.33.0, @docx-editor.dev/pro@2.33.0

## 2.32.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.32.0, @docx-editor.dev/pro@2.32.0

## 2.31.0

### Patch Changes

- Updated dependencies: @docx-editor.dev/core@2.31.0, @docx-editor.dev/pro@2.31.0

## 2.30.0

### Patch Changes

- 5a9bc6a: Log records from `toLogRecord` carry `occurrences` and `failures` counts, and `failureCount` totals failures including deduplication summaries. Events with numbers the editor cannot produce are dropped.
- b0abf51: Editors report session starts and ends, active editing time, committed edits by origin, and each `save()` call, and telemetry records them as events and metrics for session counts, edit failure rates, and save success rates.
- Updated dependencies: @docx-editor.dev/core@2.30.0, @docx-editor.dev/pro@2.30.0

## 2.29.0

### Minor Changes

- e3f8337: Add `@docx-editor.dev/telemetry`, which sends anonymous editor diagnostics, typing performance, and collaboration room metrics, including people and memory per room, to OpenTelemetry, Prometheus, Sentry, or your own exporter. Ready Grafana dashboards for these metrics are available on the [Dashboards](https://docx-editor.dev/docs/2.x/telemetry/dashboards) page.

### Patch Changes

- 838394b: Contain asynchronous exporter failures without changing exporter flush and shutdown behavior.
- 838394b: Preserve extension state and hook order when collaboration telemetry wraps frozen extensions or property accessors.
- Updated dependencies: @docx-editor.dev/core@2.29.0, @docx-editor.dev/pro@2.29.0
