// Switches where review items appear, through the review pane settings. The review rail
// reads `revisionsIn` and `overflow` live, so one `setReviewPane` call moves every tracked
// change between rail cards and page balloons, or lets a narrow window scroll sideways to
// the cards instead of floating them over the page. Nothing is written into the document.
import { useDocxEditor, useEditorState } from '@docx-editor.dev/react';
import type { ReviewPaneOverflow, RevisionDisplay } from '@docx-editor.dev/pro/react';
import { exampleText as t } from '../../shared/example-text';

export function ReviewLayoutSwitch() {
  const editor = useDocxEditor();
  const revisionsIn = useEditorState((snapshot) => snapshot.reviewPane?.revisionsIn ?? 'pane');
  const overflow = useEditorState((snapshot) => snapshot.reviewPane?.overflow ?? 'float');
  return (
    <>
      <label className="demo-review-layout">
        <span className="demo-review-layout__label">{t('reviewLayout.label')}</span>
        <select
          value={revisionsIn}
          disabled={!editor}
          onChange={(event) =>
            editor?.setReviewPane({ revisionsIn: event.target.value as RevisionDisplay })
          }
        >
          <option value="pane">{t('reviewLayout.pane')}</option>
          <option value="balloons">{t('reviewLayout.balloons')}</option>
        </select>
      </label>
      <label className="demo-review-layout">
        <span className="demo-review-layout__label">{t('reviewLayout.overflowLabel')}</span>
        <select
          value={overflow}
          disabled={!editor}
          onChange={(event) =>
            editor?.setReviewPane({ overflow: event.target.value as ReviewPaneOverflow })
          }
        >
          <option value="float">{t('reviewLayout.float')}</option>
          <option value="scroll">{t('reviewLayout.scroll')}</option>
        </select>
      </label>
    </>
  );
}
