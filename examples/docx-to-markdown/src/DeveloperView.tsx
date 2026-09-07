import { useMemo } from 'react';
import type { MarkdownExportResult } from '@docx-editor.dev/docx-to-markdown';
import type { ExportStatus } from './export-state';
import {
  developerPanelContent,
  type DeveloperPanelTab,
  type PreviewFields,
} from './developer-reference';
import { HighlightedCode } from './HighlightedCode';

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
  const content = useMemo(
    () => developerPanelContent(tab, result, status, error, fields, filename),
    [error, result, status, tab, fields, filename]
  );
  return (
    <section className="md-developer-view" aria-labelledby="developer-view-title">
      <header className="md-developer-view__header">
        <strong id="developer-view-title">Convert with one function call</strong>
      </header>
      <div className="md-install-command">
        <code>npm install @docx-editor.dev/docx-to-markdown @docx-editor.dev/fonts</code>
      </div>
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
