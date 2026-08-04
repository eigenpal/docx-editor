/**
 * Framework-agnostic helper to open a pre-filled GitHub "new issue"
 * URL for the Help > Report issue action. GitHub doesn't allow file
 * attachments via URL params, so the body asks the user to drag-drop
 * their DOCX onto the issue after it opens.
 *
 * Lifted from packages/react/src/components/reportIssue.ts so the
 * Vue adapter can re-use it without re-implementing.
 * @packageDocumentation
 * @public
 */

const ISSUE_URL = 'https://github.com/eigenpal/docx-editor/issues/new';

export interface ReportIssueEnv {
  userAgent?: string;
  viewport?: { width: number; height: number };
  /**
   * The page the report is about. Defaults to the current origin and path — deliberately
   * WITHOUT the query string or fragment, which is where hosts keep tokens and ids. Pass
   * one explicitly to include more (or less).
   */
  pageUrl?: string;
}

/**
 * The page URL, with the query string and fragment REMOVED.
 *
 * The editor ships inside other people's products, and this URL goes into a public issue
 * form on a tracker the host does not own. `location.href` carries whatever the host put
 * in its query and hash — session ids, one-time tokens, document ids — and a user clicking
 * "Report issue" is agreeing to describe a bug, not to publish their address bar. Origin
 * and path answer the only question we actually need ("which screen?").
 *
 * A caller that wants the full URL passes it explicitly through `env.pageUrl`.
 */
function currentPage(): string {
  if (typeof window === 'undefined') return '';
  try {
    const url = new URL(window.location.href);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '';
  }
}

export function buildReportIssueUrl(env: ReportIssueEnv = {}): string {
  const ua = env.userAgent ?? (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown');
  const vp =
    env.viewport ??
    (typeof window !== 'undefined'
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 0, height: 0 });
  const pageUrl = env.pageUrl ?? currentPage();

  const body = [
    '### What happened',
    '',
    '### Steps to reproduce',
    '1. ',
    '2. ',
    '3. ',
    '',
    '### Expected',
    '',
    '### Actual',
    '',
    '### Attach the DOCX',
    'Please drag the `.docx` file that reproduces this onto the issue (below this text box). Bugs are much faster to fix with a real file.',
    '',
    '### Environment',
    `- URL: ${pageUrl}`,
    `- Viewport: ${vp.width} x ${vp.height}`,
    `- User agent: ${ua}`,
    '',
  ].join('\n');

  const params = new URLSearchParams({ title: '[Bug] ', body });
  return `${ISSUE_URL}?${params.toString()}`;
}

export function openReportIssue(env?: ReportIssueEnv): void {
  if (typeof window === 'undefined') return;
  window.open(buildReportIssueUrl(env), '_blank', 'noopener,noreferrer');
}
