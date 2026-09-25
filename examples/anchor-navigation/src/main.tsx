import { useId, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  DocxEditor,
  useDocxEditor,
  type AnchorHighlightOptions,
  type ScrollToAnchorOptions,
} from '@docx-editor.dev/react';
import type { DocAnchor } from '@docx-editor.dev/core';
import { createT, en } from '@docx-editor.dev/i18n';
import '@docx-editor.dev/core/styles/editor.css';
import { PARA_IDS, sampleDocument } from './sample-document';
import './styles.css';

const t = createT(en);

// Findings as a review tool or server stores them: a paragraph ID, plus optional text.
const REFERENCES = {
  payment: { paraId: PARA_IDS.payment },
  fee: { paraId: PARA_IDS.fee },
  liability: { paraId: PARA_IDS.liability, search: 'Supplier', occurrence: 2 },
  law: { paraId: PARA_IDS.law, search: 'State of New York' },
  header: { paraId: PARA_IDS.header },
  missing: { paraId: PARA_IDS.missing },
} satisfies Record<string, DocAnchor>;

// One style object can also style document refresh highlights.
const STYLES = {
  default: {},
  amber: {
    color: 'var(--anchor-example-amber)',
    borderColor: 'var(--anchor-example-amber-border)',
    borderWidth: 2,
    borderStyle: 'dashed',
    opacity: 0.18,
  },
  glow: {
    color: 'var(--anchor-example-green)',
    opacity: 0.12,
    padding: 6,
    borderRadius: 10,
    className: 'anchor-example-glow',
    animation: { durationMs: 240, exitDurationMs: 600 },
  },
  instant: { animation: false },
} satisfies Record<string, AnchorHighlightOptions>;

const DURATIONS = { short: 1500, default: 3000, manual: null } as const;

type Reference = keyof typeof REFERENCES;
type Effect = 'both' | 'scroll' | 'highlight';
type Style = keyof typeof STYLES;
type Duration = keyof typeof DURATIONS;
type Block = NonNullable<ScrollToAnchorOptions['block']>;
type Behavior = NonNullable<ScrollToAnchorOptions['behavior']>;

interface Settings {
  reference: Reference;
  effect: Effect;
  style: Style;
  duration: Duration;
  block: Block;
  behavior: Behavior;
}

/** Print a value as the TypeScript literal that the example passes. */
function literal(value: unknown): string {
  return JSON.stringify(value, null, 2)
    .replace(/"([A-Za-z]+)":/g, '$1:')
    .replace(/"/g, "'");
}

/** The calls that the current settings make, shown next to the document. */
function callsFor(settings: Settings) {
  const { scroll, highlight } = optionsFor(settings);
  const lines = [`const anchor = ${literal(REFERENCES[settings.reference])};`];
  if (settings.effect !== 'highlight') {
    lines.push(`editor.scrollToAnchor(anchor, ${literal(scroll)});`);
  }
  if (settings.effect !== 'scroll') {
    lines.push(`editor.highlightAnchor(anchor, ${literal(highlight)});`);
  }
  return lines.join('\n');
}

function optionsFor(settings: Settings) {
  const scroll: ScrollToAnchorOptions = { block: settings.block, behavior: settings.behavior };
  const highlight: AnchorHighlightOptions = {
    ...STYLES[settings.style],
    timeoutMs: DURATIONS[settings.duration],
  };
  return { scroll, highlight };
}

function Select<T extends string>(props: {
  label: string;
  value: T;
  options: readonly T[];
  optionLabel: (value: T) => string;
  onChange: (value: T) => void;
}) {
  const id = useId();
  return (
    <div className="anchor-example-field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} value={props.value} onChange={(e) => props.onChange(e.target.value as T)}>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.optionLabel(option)}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReferencePanel() {
  const editor = useDocxEditor();
  const [settings, setSettings] = useState<Settings>({
    reference: 'law',
    effect: 'both',
    style: 'default',
    duration: 'default',
    block: 'centerIfNeeded',
    behavior: 'instant',
  });
  const [status, setStatus] = useState(t('anchorNavigation.ready'));
  const update = <K extends keyof Settings>(key: K) => {
    return (value: Settings[K]) => setSettings((current) => ({ ...current, [key]: value }));
  };

  function show() {
    if (!editor) return;
    const anchor = REFERENCES[settings.reference];
    const { scroll, highlight } = optionsFor(settings);
    if (settings.effect !== 'highlight' && !editor.scrollToAnchor(anchor, scroll)) {
      setStatus(t('anchorNavigation.scrollFailed'));
      return;
    }
    if (settings.effect !== 'scroll' && !editor.highlightAnchor(anchor, highlight)) {
      setStatus(
        t(
          settings.effect === 'both'
            ? 'anchorNavigation.highlightFailed'
            : 'anchorNavigation.highlightOnlyFailed'
        )
      );
      return;
    }
    setStatus(t(`anchorNavigation.done.${settings.effect}`));
  }

  function clear() {
    editor?.clearAnchorHighlight();
    setStatus(t('anchorNavigation.cleared'));
  }

  const scrolls = settings.effect !== 'highlight';
  const highlights = settings.effect !== 'scroll';
  return (
    <aside className="anchor-example-panel">
      <h1>{t('anchorNavigation.title')}</h1>
      <p>{t('anchorNavigation.description')}</p>
      <Select
        label={t('anchorNavigation.reference')}
        value={settings.reference}
        options={Object.keys(REFERENCES) as Reference[]}
        optionLabel={(value) => t(`anchorNavigation.references.${value}`)}
        onChange={update('reference')}
      />
      <Select
        label={t('anchorNavigation.effect')}
        value={settings.effect}
        options={['both', 'scroll', 'highlight'] as const}
        optionLabel={(value) => t(`anchorNavigation.effects.${value}`)}
        onChange={update('effect')}
      />
      {highlights && (
        <>
          <Select
            label={t('anchorNavigation.style')}
            value={settings.style}
            options={Object.keys(STYLES) as Style[]}
            optionLabel={(value) => t(`anchorNavigation.styles.${value}`)}
            onChange={update('style')}
          />
          <Select
            label={t('anchorNavigation.duration')}
            value={settings.duration}
            options={Object.keys(DURATIONS) as Duration[]}
            optionLabel={(value) => t(`anchorNavigation.durations.${value}`)}
            onChange={update('duration')}
          />
        </>
      )}
      {scrolls && (
        <>
          <Select
            label={t('anchorNavigation.position')}
            value={settings.block}
            options={['centerIfNeeded', 'center', 'start', 'nearest'] as const}
            optionLabel={(value) => t(`anchorNavigation.positions.${value}`)}
            onChange={update('block')}
          />
          <Select
            label={t('anchorNavigation.motion')}
            value={settings.behavior}
            options={['instant', 'smooth'] as const}
            optionLabel={(value) => t(`anchorNavigation.motions.${value}`)}
            onChange={update('behavior')}
          />
        </>
      )}
      <div className="anchor-example-actions">
        <button className="anchor-example-primary" disabled={!editor} onClick={show}>
          {t('anchorNavigation.show')}
        </button>
        <button disabled={!editor} onClick={clear}>
          {t('anchorNavigation.clear')}
        </button>
      </div>
      <p role="status" className="anchor-example-status">
        {status}
      </p>
      <h2>{t('anchorNavigation.code')}</h2>
      <pre>
        <code>{callsFor(settings)}</code>
      </pre>
    </aside>
  );
}

function App() {
  const [document] = useState(sampleDocument);
  return (
    <div className="docx-editor anchor-example">
      <DocxEditor.Root document={document} mode="edit">
        <ReferencePanel />
        <main className="anchor-example-document">
          <DocxEditor.Toolbar />
          <DocxEditor.Viewport style={{ flex: 1, minHeight: 0 }}>
            <DocxEditor.Content />
          </DocxEditor.Viewport>
        </main>
      </DocxEditor.Root>
    </div>
  );
}

createRoot(window.document.getElementById('root')!).render(<App />);
