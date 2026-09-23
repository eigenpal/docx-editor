import {
  createDocumentRefresh,
  type DocxEditorInstance,
  type RefreshSubmission,
} from '@docx-editor.dev/core/editor';
import type { TFunction } from '@docx-editor.dev/i18n';
import { refreshFixture, sampleProcessor } from './refresh-demo-fixture';

/** Shared example transport and controls. Both adapters use the engine controller. */
export function mountRefreshDemoControls(
  container: HTMLElement,
  editor: DocxEditorInstance,
  t: TFunction
) {
  const refresh = createDocumentRefresh(editor);
  const doc = container.ownerDocument;
  let disposed = false;
  let run = 0;
  let index = -1;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = doc.createElement(tag);
    if (text) element.textContent = text;
    return element;
  };
  const title = make('h1', t('documentRefresh.title'));
  const description = make('p', t('documentRefresh.description'));
  const limits = make('p', t('documentRefresh.limitations'));
  const status = make('p');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  const controls = make('div');
  controls.className = 'refresh-demo-buttons';
  const button = (label: string, action: () => void) => {
    const element = make('button', label);
    element.type = 'button';
    element.addEventListener('click', action);
    element.addEventListener('mousedown', (event) => event.preventDefault());
    controls.append(element);
    return element;
  };
  const render = () => {
    if (disposed) return;
    const state = refresh.snapshot();
    const active = ['capturing', 'processing', 'refreshing', 'recovering'].includes(state.phase);
    start.disabled = active;
    cancel.disabled = !active;
    const changes = state.changes.filter((change) => change.isNew && change.status === 'available');
    const replacing = ['refreshing', 'recovering'].includes(state.phase);
    show.disabled = replacing || changes.length === 0;
    clear.disabled = !state.highlightsVisible;
    previous.disabled = next.disabled = replacing || changes.length === 0;
    retry.hidden = download.hidden = !state.recoveryAvailable;
    let message = t(`documentRefresh.${state.phase}`);
    if (state.result && !state.result.ok) {
      if (state.result.code === 'local-edits') message = t('documentRefresh.localEdits');
      if (state.result.code === 'invalid-document') message = t('documentRefresh.invalidDocument');
      if (state.result.code === 'recovery-failed') message = t('documentRefresh.recoveryFailed');
    }
    status.textContent = message;
    summary.textContent = changes.length
      ? t('documentRefresh.count', { count: changes.length })
      : state.phase === 'complete'
        ? t('documentRefresh.empty')
        : '';
    partial.textContent =
      state.result?.ok && state.result.failures.length
        ? t('documentRefresh.partial', { count: state.result.failures.length })
        : '';
  };
  const start = button(t('documentRefresh.start'), () => {
    const current = ++run;
    void (async () => {
      let submission: RefreshSubmission | undefined;
      try {
        submission = await refresh.capture();
        for (const sequence of [1, 2]) {
          // Replace this controlled delivery with your application's backend or event stream.
          await new Promise((resolve) => setTimeout(resolve, 1800));
          if (disposed || current !== run) return;
          const output = await sampleProcessor(submission.bytes, sequence);
          const result = await refresh.applyUpdate({ submission, sequence, ...output });
          if (!result.ok) return;
          index = -1;
          refresh.highlightChanges();
        }
      } catch {
        if (!disposed) status.textContent = t('documentRefresh.failed');
      } finally {
        if (submission) refresh.finish(submission);
      }
    })();
  });
  const cancel = button(t('documentRefresh.cancel'), () => {
    run++;
    refresh.cancel();
  });
  button(t('documentRefresh.reset'), () => {
    run++;
    refresh.cancel();
    editor.load(refreshFixture());
  });
  const show = button(t('documentRefresh.show'), () => refresh.highlightChanges());
  const clear = button(t('documentRefresh.clear'), () => refresh.clearHighlights());
  const navigate = (direction: number) => {
    const changes = refresh
      .snapshot()
      .changes.filter((change) => change.isNew && change.status === 'available');
    if (!changes.length) return;
    index =
      index < 0
        ? direction < 0
          ? changes.length - 1
          : 0
        : (index + direction + changes.length) % changes.length;
    if (refresh.navigateToChange(changes[index]!.id, { block: 'centerIfNeeded' })) {
      refresh.highlightChanges({ changeIds: [changes[index]!.id] });
      summary.textContent = t('documentRefresh.position', {
        current: index + 1,
        total: changes.length,
      });
    }
  };
  const previous = button(t('documentRefresh.previous'), () => navigate(-1));
  const next = button(t('documentRefresh.next'), () => navigate(1));
  const retry = button(t('documentRefresh.retry'), () => {
    void refresh.recover();
  });
  const download = button(t('documentRefresh.download'), () => {
    const bytes = refresh.recoveryBytes();
    if (!bytes) return;
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      })
    );
    const link = make('a');
    link.href = url;
    link.download = 'recovered.docx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  const summary = make('p');
  summary.setAttribute('aria-live', 'polite');
  const partial = make('p');
  partial.setAttribute('role', 'status');
  container.replaceChildren(title, description, controls, status, summary, partial, limits);
  const unsubscribe = refresh.subscribe(render);
  render();
  return () => {
    disposed = true;
    run++;
    unsubscribe();
    refresh.cancel();
    container.replaceChildren();
  };
}
