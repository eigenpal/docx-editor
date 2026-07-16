// Re-export the framework-agnostic helpers so existing React imports keep
// working; the canonical implementations live in core.
export {
  buildReportIssueUrl,
  openReportIssue,
  type ReportIssueEnv,
} from '@docx-editor.dev/core/utils/reportIssue';
