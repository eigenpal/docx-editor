# @docx-editor.dev/telemetry

## 2.29.0

### Minor Changes

- e3f8337: Add `@docx-editor.dev/telemetry`, which sends anonymous editor diagnostics, typing performance, and collaboration room metrics, including people and memory per room, to OpenTelemetry, Prometheus, Sentry, or your own exporter. Ready Grafana dashboards for these metrics are available on the [Dashboards](https://docx-editor.dev/docs/2.x/telemetry/dashboards) page.

### Patch Changes

- 838394b: Contain asynchronous exporter failures without changing exporter flush and shutdown behavior.
- 838394b: Preserve extension state and hook order when collaboration telemetry wraps frozen extensions or property accessors.
- Updated dependencies: @docx-editor.dev/core@2.29.0, @docx-editor.dev/pro@2.29.0
