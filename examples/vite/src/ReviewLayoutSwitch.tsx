// Switches where review items appear, through the editor's viewer preferences. The review
// rail reads `revisionsIn` and `paneOverflow` live, so one `setRevisionMarkup` call moves
// every tracked change between rail cards and page balloons, or lets a narrow window
// scroll sideways to the cards instead of floating them over the page. Nothing is written
// into the document.
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import type { PaneOverflow, RevisionsIn } from '@docx-editor.dev/react';
import { exampleText as t } from '../../shared/example-text';

export function ReviewLayoutSwitch() {
  const editor = useDocxEditor();
  const revisionsIn = useEditorState((snapshot) => snapshot.revisionMarkup.revisionsIn);
  const paneOverflow = useEditorState((snapshot) => snapshot.revisionMarkup.paneOverflow);
  return (
    <>
      <label className="demo-review-layout">
        <span className="demo-review-layout__label">{t('reviewLayout.label')}</span>
        <select
          value={revisionsIn}
          disabled={!editor}
          onChange={(event) =>
            editor?.setRevisionMarkup({ revisionsIn: event.target.value as RevisionsIn })
          }
        >
          <option value="pane">{t('reviewLayout.pane')}</option>
          <option value="balloons">{t('reviewLayout.balloons')}</option>
        </select>
      </label>
      <label className="demo-review-layout">
        <span className="demo-review-layout__label">{t('reviewLayout.overflowLabel')}</span>
        <select
          value={paneOverflow}
          disabled={!editor}
          onChange={(event) =>
            editor?.setRevisionMarkup({ paneOverflow: event.target.value as PaneOverflow })
          }
        >
          <option value="float">{t('reviewLayout.float')}</option>
          <option value="scroll">{t('reviewLayout.scroll')}</option>
        </select>
      </label>
    </>
  );
}
