import { useCallback, useState } from 'react';
import {
  useDocxEditor,
  useDocumentOutline,
  useDocumentSearch,
  useEditorCommand,
  useEditorEvent,
  useEditorState,
  useEditorValueCommand,
  useTranslation,
} from '@docx-editor.dev/react';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import { keepCaret } from './demoButtons';

const selectSnapshot = (snapshot: EditorSnapshot) => snapshot;

interface CapturedSnapshot {
  readonly page: string;
  readonly zoom: string;
  readonly mode: string;
  readonly scope: string;
}

interface EventReading {
  readonly id: number;
  readonly label: string;
}

/**
 * A host-owned learning panel over the public facade and React hooks.
 *
 * The packaged toolbar already demonstrates polished editor chrome. This panel instead
 * exposes the state behind that chrome, including the engine's own refusal reasons.
 */
export function ConsumerApiPanel() {
  const { t } = useTranslation();
  const editor = useDocxEditor();
  const snapshot = useEditorState(selectSnapshot);
  const bold = useEditorCommand('text.bold');
  const suggesting = useEditorCommand({ type: 'setEditingMode', mode: 'suggesting' });
  const imageWrap = useEditorValueCommand('image.wrap');
  const outline = useDocumentOutline();
  const search = useDocumentSearch();
  const [open, setOpen] = useState(true);
  const [captured, setCaptured] = useState<CapturedSnapshot | null>(null);
  const [events, setEvents] = useState<readonly EventReading[]>([]);

  const recordEvent = useCallback((label: string) => {
    setEvents((current) => [{ id: Date.now() + Math.random(), label }, ...current.slice(0, 2)]);
  }, []);

  useEditorEvent(
    'change',
    useCallback(
      (change) => recordEvent(t('consumerApi.eventChange', { revision: change.revision })),
      [recordEvent, t]
    )
  );
  useEditorEvent(
    'selectionChange',
    useCallback(
      (next) =>
        recordEvent(
          t('consumerApi.eventSelection', {
            current: next.page.current,
            total: next.page.total,
          })
        ),
      [recordEvent, t]
    )
  );
  useEditorEvent(
    'error',
    useCallback(
      (error) => recordEvent(t('consumerApi.eventError', { message: error.message })),
      [recordEvent, t]
    )
  );

  const captureSnapshot = () => {
    const next = editor?.snapshot();
    if (!next) return;
    setCaptured({
      page: `${next.page.current}/${next.page.total}`,
      zoom: `${Math.round(next.zoom * 100)}%`,
      mode: next.editingMode ?? 'editing',
      scope: next.scope.kind,
    });
  };

  const formatting = snapshot.formatting;
  const table = snapshot.table;
  const image = snapshot.image;
  const boldReason = bold.disabledReason;
  const suggestingReason = suggesting.disabledReason;
  const wrapReason = imageWrap.disabledReason;

  return (
    <aside className={`consumer-api${open ? ' consumer-api--open' : ''}`}>
      <button
        type="button"
        className="consumer-api__toggle"
        aria-expanded={open}
        aria-label={open ? t('consumerApi.hide') : t('consumerApi.show')}
        title={open ? t('consumerApi.hide') : t('consumerApi.show')}
        onMouseDown={keepCaret}
        onClick={() => setOpen((current) => !current)}
      >
        API
      </button>

      {open ? (
        <div className="consumer-api__card" data-testid="consumer-api-panel">
          <div className="consumer-api__heading">
            <div>
              <strong>{t('consumerApi.title')}</strong>
              <span>{t('consumerApi.subtitle')}</span>
            </div>
            <button
              type="button"
              className="consumer-api__close"
              aria-label={t('consumerApi.hide')}
              onMouseDown={keepCaret}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </div>

          <section className="consumer-api__section">
            <h3>{t('consumerApi.liveState')}</h3>
            <dl className="consumer-api__grid">
              <div>
                <dt>{t('consumerApi.page')}</dt>
                <dd>{`${snapshot.page.current}/${snapshot.page.total}`}</dd>
              </div>
              <div>
                <dt>{t('consumerApi.zoom')}</dt>
                <dd>{`${Math.round(snapshot.zoom * 100)}%`}</dd>
              </div>
              <div>
                <dt>{t('consumerApi.mode')}</dt>
                <dd>{snapshot.editingMode ?? 'editing'}</dd>
              </div>
              <div>
                <dt>{t('consumerApi.selection')}</dt>
                <dd>
                  {snapshot.selectionCollapsed ? t('consumerApi.caret') : t('consumerApi.range')}
                </dd>
              </div>
            </dl>
            <p className="consumer-api__detail">
              {formatting
                ? t('consumerApi.formatting', {
                    bold: formatting.bold ? t('consumerApi.on') : t('consumerApi.off'),
                    italic: formatting.italic ? t('consumerApi.on') : t('consumerApi.off'),
                    style: formatting.styleId ?? '—',
                  })
                : t('consumerApi.noFormatting')}
            </p>
            <div className="consumer-api__actions">
              <button
                type="button"
                data-active={bold.isActive || undefined}
                disabled={!bold.isEnabled}
                title={boldReason ?? t('consumerApi.toggleBold')}
                onMouseDown={keepCaret}
                onClick={bold.execute}
              >
                {t('consumerApi.toggleBold')}
              </button>
              <button
                type="button"
                data-active={suggesting.isActive || undefined}
                disabled={!suggesting.isEnabled}
                title={suggestingReason ?? t('consumerApi.useSuggesting')}
                onMouseDown={keepCaret}
                onClick={suggesting.execute}
              >
                {t('consumerApi.useSuggesting')}
              </button>
            </div>
            {boldReason || suggestingReason ? (
              <p className="consumer-api__reason" role="status">
                {boldReason ?? suggestingReason}
              </p>
            ) : null}
          </section>

          <section className="consumer-api__section">
            <h3>{t('consumerApi.navigation')}</h3>
            <div className="consumer-api__search">
              <input
                value={search.query}
                placeholder={t('navigation.find.placeholder')}
                aria-label={t('navigation.find.inputAriaLabel')}
                onChange={(event) => search.setQuery(event.target.value)}
              />
              <button
                type="button"
                disabled={search.matches.length === 0}
                title={
                  search.matches.length === 0
                    ? t('consumerApi.noSearchResults')
                    : t('navigation.find.nextAriaLabel')
                }
                onMouseDown={keepCaret}
                onClick={search.next}
              >
                {t('consumerApi.next')}
              </button>
            </div>
            <p className="consumer-api__detail">
              {t('consumerApi.searchState', {
                count: search.matches.length,
                pending: search.isPending ? t('consumerApi.pending') : t('consumerApi.ready'),
              })}
            </p>
            <div className="consumer-api__actions">
              <button
                type="button"
                disabled={outline.headings.length === 0}
                title={
                  outline.headings.length === 0
                    ? t('consumerApi.noHeadings')
                    : t('consumerApi.firstHeading')
                }
                onMouseDown={keepCaret}
                onClick={() => {
                  const first = outline.headings[0];
                  if (first) outline.goTo(first.blockId);
                }}
              >
                {t('consumerApi.firstHeading')}
              </button>
              <span>
                {t('consumerApi.outlineState', {
                  count: outline.headings.length,
                  selected: outline.selectedBlockId ? t('consumerApi.yes') : t('consumerApi.no'),
                })}
              </span>
            </div>
          </section>

          <section className="consumer-api__section">
            <h3>{t('consumerApi.context')}</h3>
            <p className="consumer-api__detail">
              {table
                ? t('consumerApi.tableState', {
                    rows: table.rows,
                    columns: table.columns,
                    row: table.rowIndex + 1,
                    column: table.columnIndex + 1,
                  })
                : t('consumerApi.noTable')}
            </p>
            <p className="consumer-api__detail">
              {image
                ? t('consumerApi.imageState', {
                    name: image.name || image.id,
                    width: Math.round(image.widthEmu / 9525),
                    height: Math.round(image.heightEmu / 9525),
                  })
                : t('consumerApi.noImage')}
            </p>
            <label className="consumer-api__field">
              <span>{t('consumerApi.imageWrap')}</span>
              <select
                value={imageWrap.value ?? ''}
                disabled={!imageWrap.isEnabled}
                title={wrapReason ?? t('consumerApi.imageWrap')}
                onChange={(event) =>
                  imageWrap.execute(event.target.value as (typeof imageWrap.options)[number])
                }
              >
                <option value="">{t('consumerApi.notAvailable')}</option>
                {imageWrap.options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
            {wrapReason ? (
              <p className="consumer-api__reason" role="status">
                {wrapReason}
              </p>
            ) : null}
          </section>

          <section className="consumer-api__section">
            <h3>{t('consumerApi.facade')}</h3>
            <button type="button" onMouseDown={keepCaret} onClick={captureSnapshot}>
              {t('consumerApi.capture')}
            </button>
            <p className="consumer-api__detail">
              {captured
                ? t('consumerApi.captured', {
                    page: captured.page,
                    zoom: captured.zoom,
                    mode: captured.mode,
                    scope: captured.scope,
                  })
                : t('consumerApi.captureHint')}
            </p>
            <h3>{t('consumerApi.events')}</h3>
            {events.length > 0 ? (
              <ol className="consumer-api__events" aria-live="polite">
                {events.map((event) => (
                  <li key={event.id}>{event.label}</li>
                ))}
              </ol>
            ) : (
              <p className="consumer-api__detail">{t('consumerApi.noEvents')}</p>
            )}
          </section>
        </div>
      ) : null}
    </aside>
  );
}
