/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/telemetry/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/**
 * Anonymous diagnostics, metrics, and error reporting for editors and collaboration servers.
 *
 * - `@docx-editor.dev/telemetry`: {@link createTelemetry} for editors, the console, callback,
 *   memory, and HTTP exporters, and {@link browserPrivacySignals}.
 * - `@docx-editor.dev/telemetry/ingest`: a route that receives telemetry from `httpExporter`
 *   and forwards it to a log service.
 * - `@docx-editor.dev/telemetry/otel`: OpenTelemetry metrics and traces through your SDK.
 * - `@docx-editor.dev/telemetry/sentry`: Sentry issues and breadcrumbs.
 * - `@docx-editor.dev/telemetry/prometheus`: a `/metrics` endpoint.
 * - `@docx-editor.dev/telemetry/server`: room telemetry for any Yjs server.
 * - `@docx-editor.dev/telemetry/hocuspocus`: room telemetry for Hocuspocus in one call.
 *
 * @packageDocumentation
 */

export {
  createTelemetry,
  type Telemetry,
  type TelemetryArea,
  type TelemetryAreaOptions,
  type TelemetryInclude,
  type TelemetryOptions,
} from './client.ts';
export {
  browserPrivacySignals,
  httpExporter,
  type BrowserPrivacySignalsOptions,
  type HttpExporterOptions,
} from './http.ts';
export {
  callbackExporter,
  consoleExporter,
  isFailure,
  memoryExporter,
  type ConsoleExporterOptions,
  type MemoryExporter,
} from './exporters.ts';
export {
  METRICS,
  prometheusName,
  type MetricDefinition,
  type MetricId,
  type MetricKind,
} from './metrics.ts';
export {
  ENGINE_VERSION,
  MAX_METRIC_LABEL_VALUES,
  type AttributeValue,
  type Attributes,
  type MetricRecord,
  type TelemetryEvent,
  type TelemetryEventContext,
  type TelemetryExporter,
  type TelemetryExporterContext,
  type TelemetryPipelineOptions,
} from './pipeline.ts';
export { explainDiagnostic } from '@docx-editor.dev/core';
export type {
  ByteSizeBucket,
  CollaborationDiagnosticCode,
  CollaborationParticipantsDiagnostic,
  CollaborationStatusDiagnostic,
  CountBucket,
  CustomNodeDiagnosticCode,
  CustomNodeDiagnosticEvent,
  DiagnosticBase,
  DiagnosticCode,
  DiagnosticErrorName,
  DiagnosticExplanation,
  DiagnosticFailureDetail,
  DocumentOpenDiagnostic,
  DocumentOpenDiagnosticCode,
  DocumentPartKind,
  DocumentShape,
  FailureStage,
  EditDiagnosticCode,
  EditRejectedDiagnostic,
  EditRejectionOrigin,
  EditorDiagnostic,
  EditorDiagnosticKind,
  FontDiagnosticCode,
  FontFailedDiagnostic,
  FormattingChangeKind,
  HistoryDiagnosticCode,
  HistoryDiagnosticEvent,
  PerformanceDiagnostic,
  PerformanceDiagnosticCode,
  ReviewChangeKind,
  ReviewDiagnosticCode,
  ReviewOperation,
  ReviewSkippedDiagnostic,
  TimingSummary,
} from '@docx-editor.dev/core';
