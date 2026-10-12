# Observability assets

Grafana dashboards and Prometheus alert rules for `@docx-editor.dev/telemetry`. Import them into your own Grafana and Prometheus to see how editing feels to your users and how your collaboration server runs.

The dashboards report measurements only and set no targets. Decide what is acceptable from a few weeks of your own traffic, then add your own alerts for it.

| File | What it is |
| --- | --- |
| `grafana/editor-experience.json` | **Editor experience**: input delay, engine layout and paint time, opens, refused tracked changes, skipped tracked changes, and all refused edits by code, filtered by environment, app, app version, and editor version. |
| `grafana/collaboration.json` | **Collaboration**: server state, rooms and people, room memory and limits, room load and store time, client status, and refused connections and messages. |
| `prometheus/rules.yml` | Alerts on clear faults: a collaboration server that stops answering, room stores that fail, and telemetry events the privacy check drops. |
| `generate.py` | Generates every file above. |

## Import the dashboards

1. In Grafana, go to **Dashboards** > **New** > **Import**, and upload a JSON file.
2. Open the dashboard, and select your Prometheus data source in **Data source**.
3. Select the **App** and **Environment** values. On the collaboration dashboard, select the **Server** job and its instances.

The dashboards read the Prometheus names in the [metrics reference](https://docx-editor.dev/docs/2.x/telemetry/metrics). Editor metrics reach Prometheus from browsers through your OpenTelemetry SDK and an OpenTelemetry Protocol (OTLP) collector. Server metrics come from the `/metrics` endpoint of your collaboration server.

The filters use these labels:

| Label | Comes from |
| --- | --- |
| `job` | `service.name` on your OpenTelemetry SDK. |
| `deployment_environment` | `deployment.environment`, which you add with `attributes` and `metricLabels`. |
| `app_version` | `app.version`, which you add with `attributes` and `metricLabels`. |
| `docx_editor_version` | Added by the telemetry package to every editor metric. |

```ts
createTelemetry({
  exporters: [otelExporter()],
  attributes: { 'deployment.environment': 'production', 'app.version': '4.2.0' },
  metricLabels: ['deployment.environment', 'app.version'],
});
```

## Load the alert rules

Add the file to `rule_files` in your Prometheus configuration, or copy the rules into your own rule group:

```yaml
rule_files:
  - /etc/prometheus/docx-editor-rules.yml
```

Change the `job="collaboration-server"` selector to the job name of your server's scrape.

## Try them locally

[`examples/telemetry-stack`](../../examples/telemetry-stack) runs an OpenTelemetry collector, Prometheus, Jaeger, and Grafana with these files, and simulates people who edit.

## Change the dashboards

Edit `generate.py`, then run:

```bash
python3 assets/observability/generate.py
bun run format
```

For setup and options, see the [telemetry docs](https://docx-editor.dev/docs/2.x/telemetry). To report a problem, [open an issue](https://github.com/eigenpal/docx-editor/issues/new/choose).
