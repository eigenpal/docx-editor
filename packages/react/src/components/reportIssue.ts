// Re-export the framework-agnostic helpers so existing React imports keep working.
// Legacy kept the implementations in core; the greenfield core is the semantic engine and
// owns no issue-reporting URL builder, so the file is ported verbatim into `lib/`
// alongside the component that uses it.
export {
  buildReportIssueUrl,
  openReportIssue,
  type ReportIssueEnv,
} from '../lib/reportIssue';
