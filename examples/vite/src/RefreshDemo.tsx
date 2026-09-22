import { useEffect, useRef, useState } from 'react';
import { DocxEditor, useDocxEditor, useTranslation } from '@docx-editor.dev/react';
import { mountRefreshDemoControls } from '../../shared/refresh-demo-controls';
import { refreshFixture } from '../../shared/refresh-demo-fixture';
import '../../shared/refresh-demo.css';

function Controls() {
  const editor = useDocxEditor();
  const root = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();
  useEffect(() => {
    if (editor && root.current) return mountRefreshDemoControls(root.current, editor, t);
  }, [editor, t]);
  return <section ref={root} className="refresh-demo-panel" />;
}
export function RefreshDemo() {
  const [document] = useState(refreshFixture);
  return (
    <div className="docx-editor refresh-demo">
      <DocxEditor.Root document={document} mode="edit">
        <Controls />
        <DocxEditor.Toolbar />
        <DocxEditor.Viewport style={{ flex: 1, minHeight: 0 }}>
          <DocxEditor.Content />
        </DocxEditor.Viewport>
      </DocxEditor.Root>
    </div>
  );
}
