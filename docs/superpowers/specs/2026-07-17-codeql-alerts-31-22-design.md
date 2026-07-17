# CodeQL Alerts 31 and 22 Remediation Design

## Goal

Remove the uncontrolled-input polynomial ReDoS reported in alert 31 and the
prototype-chain mutation path reported in alert 22 without changing valid
clipboard or i18n behavior.

## Design

For clipboard cleanup, replace the unanchored XML-declaration regex with a
case-insensitive linear scanner. It removes complete `<?xml ...>` declarations,
preserves surrounding text, and preserves an unterminated declaration exactly
as the previous regex did. Regression coverage includes ordinary declarations
and a long sequence of unterminated `<?xml` openers.

For i18n dotted-path writes, move the path mutation helpers into a focused
script library so they can be tested directly. Reject `__proto__`,
`constructor`, and `prototype`; descend only through own properties; and create
or replace properties with own data properties. This prevents safe-looking
path segments from traversing inherited objects as well as blocking the
well-known dangerous segments.

## Verification

Use red-green tests for both alerts, then run the focused clipboard and i18n
tests, `bun run i18n:validate`, and `bun run typecheck`. Add a patch changeset
for `@docx-editor.dev/core` because clipboard handling is published behavior.

No alert will be dismissed manually. GitHub closes the alerts after CodeQL
analyzes the merged fix.
