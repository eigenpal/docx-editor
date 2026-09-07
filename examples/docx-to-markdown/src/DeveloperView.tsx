import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarkdownExportResult } from '@docx-editor.dev/docx-to-markdown';
import type { ExportStatus } from './export-state';
import {
  developerPanelContent,
  type DeveloperPanelTab,
  type PreviewFields,
} from './developer-reference';
import { HighlightedCode } from './HighlightedCode';

const INSTALL_COMMAND = 'npm install @docx-editor.dev/docx-to-markdown @docx-editor.dev/fonts';

export function DeveloperView({
  tab,
  result,
  status,
  error,
  onTabChange,
  fields,
  filename,
}: {
  readonly fields: PreviewFields;
  readonly filename: string;
  readonly tab: DeveloperPanelTab;
  readonly result: MarkdownExportResult | null;
  readonly status: ExportStatus;
  readonly error: string | null;
  readonly onTabChange: (tab: DeveloperPanelTab) => void;
}) {
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    },
    []
  );
  const copyInstallCommand = async () => {
    if (copyTimer.current !== null) clearTimeout(copyTimer.current);
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('error');
    }
    copyTimer.current = setTimeout(() => setCopyStatus('idle'), 2000);
  };
  const content = useMemo(
    () => developerPanelContent(tab, result, status, error, fields, filename),
    [error, result, status, tab, fields, filename]
  );
  return (
    <section className="md-developer-view" aria-labelledby="developer-view-title">
      <header className="md-developer-view__header">
        <strong id="developer-view-title">Convert with one function call</strong>
      </header>
      <button
        type="button"
        className="md-install-command"
        onClick={copyInstallCommand}
        aria-label="Copy npm install command"
        title="Copy install command"
      >
        <code>{INSTALL_COMMAND}</code>
        <span className="md-install-copy" data-visible={copyStatus !== 'idle'} aria-live="polite">
          {copyStatus === 'copied' ? 'Copied' : copyStatus === 'error' ? 'Try again' : 'Copy'}
        </span>
      </button>
      <p className="md-code-note">Example follows your preview settings.</p>
      <div className="md-developer-tabs" role="group" aria-label="Developer reference">
        <button
          type="button"
          aria-pressed={tab === 'example'}
          onClick={() => onTabChange('example')}
        >
          Node.js
        </button>
        <button
          type="button"
          aria-pressed={tab === 'response'}
          onClick={() => onTabChange('response')}
        >
          Live response
        </button>
      </div>
      <HighlightedCode
        code={content}
        language={tab === 'example' ? 'typescript' : 'json'}
        label={tab === 'example' ? 'TypeScript code example' : 'JSON API response'}
      />
    </section>
  );
}
