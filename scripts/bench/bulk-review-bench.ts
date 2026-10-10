// Reproduce the integration cost, including synchronous review refresh and layout, in happy-dom.
import { GlobalRegistrator } from '@happy-dom/global-registrator';
GlobalRegistrator.register();
import { zipSync, strToU8 } from 'fflate';
import { createDocxEditor } from '../../packages/core/src/editor/docx-editor.ts';
import { reviewModule } from '../../packages/pro/src/index.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
function bytes(count: number) {
  const body = Array.from(
    { length: count },
    (_, index) =>
      `<w:p><w:ins w:id="${index}" w:author="${index % 2 ? 'Grace' : 'Ada'}"><w:r><w:t>Revision ${index}</w:t></w:r></w:ins></w:p>`
  ).join('');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body>${body}</w:body></w:document>`
    ),
  });
}
const actionOption =
  process.argv.find((value) => value.startsWith('--action='))?.split('=')[1] ?? 'accept';
if (actionOption !== 'accept' && actionOption !== 'reject')
  throw new Error('Use --action=accept or --action=reject');
const action = actionOption;
const counts = process.argv
  .slice(2)
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);
for (const count of counts.length ? counts : [100, 1000, 10000]) {
  for (const mode of (process.argv.includes('--batch-only') ? ['batch'] : ['batch', 'loop']) as (
    | 'batch'
    | 'loop'
  )[]) {
    const container = document.createElement('div');
    document.body.append(container);
    const editor = createDocxEditor({
      container,
      modules: [reviewModule()],
      onError: (error) => console.error(error),
    });
    editor.load(bytes(count));
    while (editor.snapshot().isOpening) await new Promise((resolve) => setTimeout(resolve, 10));
    if (!editor.surface) throw new Error(JSON.stringify(editor.snapshot().parseError));
    const surface = editor.surface!;
    editor.setReviewAuthorVisible('Grace', false);
    const keys = editor.getReviewItems({ placement: false }).map((item) => item.key);
    let commits = 0;
    let refreshCycles = 0;
    const originalCommit = surface.commitReviewOps.bind(surface);
    surface.commitReviewOps = (...args) => {
      refreshCycles++;
      return originalCommit(...args);
    };
    const off = editor.on('change', () => {
      commits++;
    });
    const initialFullPasses = surface.state().perf.fullPasses;
    let completed = 0;
    const start = performance.now();
    if (mode === 'batch') {
      const result = editor.exec({ type: 'resolveAllReviewChanges', action });
      completed = result.revisions?.resolved.length ?? 0;
      if (!result.ok || result.revisions?.resolved.length !== keys.length)
        throw new Error(JSON.stringify(result));
    } else {
      for (const key of keys) {
        const result =
          action === 'accept' ? editor.acceptReviewItem(key) : editor.rejectReviewItem(key);
        if (!result.ok) throw new Error('per-card resolution failed');
        completed++;
        if (!process.argv.includes('--full-loop') && performance.now() - start >= 60_000) break;
      }
    }
    const ms = performance.now() - start;
    const fullLayoutPasses = surface.state().perf.fullPasses - initialFullPasses;
    if (mode === 'batch' && (commits !== 1 || refreshCycles !== 1))
      throw new Error('batch refreshed more than once');
    if (mode === 'batch' && fullLayoutPasses > 1)
      throw new Error('batch performed more than one full layout');
    if (surface.session.reviewItems().length !== count - completed)
      throw new Error('hidden revisions changed');
    console.log(
      JSON.stringify({
        action,
        count,
        selected: keys.length,
        completed,
        finished: completed === keys.length,
        mode,
        ms: Math.round(ms * 10) / 10,
        commits,
        refreshCycles,
        fullLayoutPasses,
      })
    );
    off();
    editor.destroy();
    container.remove();
  }
}
GlobalRegistrator.unregister();
