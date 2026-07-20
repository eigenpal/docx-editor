import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { afterAll, beforeAll } from 'bun:test';

// Register happy-dom for this file and unregister after, matching the rest of
// the suite. A load-time register that never unregisters leaks the global
// registration across files and collides with other files' setup.
beforeAll(() => GlobalRegistrator.register());
afterAll(() => GlobalRegistrator.unregister());
import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, render } from '@testing-library/react';
import { DocxEditorToolbar } from './DocxEditorToolbar';

afterEach(() => {
  cleanup();
});

function renderToolbar({ showHelpMenu }: { showHelpMenu: boolean }) {
  const noop = () => {};
  return render(
    <DocxEditorToolbar
      toolbarRefCallback={noop}
      agentPanelOpen={false}
      setAgentPanelOpen={noop}
      document={null}
      theme={null}
      pmState={null}
      selectionFormatting={{}}
      tableContext={null}
      imageContext={null}
      readOnly={false}
      editingMode="editing"
      setEditingMode={noop}
      setShowCommentsSidebar={noop}
      setExpandedSidebarItem={noop}
      showCommentsSidebar={false}
      agentPanel={undefined}
      renderLogo={undefined}
      documentName={undefined}
      onDocumentNameChange={undefined}
      documentNameEditable={true}
      renderTitleBarRight={undefined}
      toolbarExtra={null}
      fontFamilies={undefined}
      zoom={1}
      showZoomControl={false}
      onFormat={noop}
      onUndo={noop}
      onRedo={noop}
      onPrint={noop}
      showFileOpen={true}
      showHelpMenu={showHelpMenu}
      onOpen={noop}
      onSave={noop}
      onZoomChange={noop}
      onRefocusEditor={noop}
      onInsertTable={noop}
      onInsertImage={noop}
      onInsertPageBreak={noop}
      onInsertSectionBreakNextPage={noop}
      onInsertSectionBreakContinuous={noop}
      onInsertTOC={noop}
      onImageWrapType={noop}
      onImageTransform={noop}
      onOpenImageProperties={noop}
      onPageSetup={noop}
      onWatermark={noop}
      onTableAction={noop}
    />
  );
}

describe('Help menu visibility', () => {
  test('shows the Help menu by default', () => {
    const toolbar = renderToolbar({ showHelpMenu: true });
    expect(toolbar.getByRole('button', { name: 'Help' })).toBeTruthy();
  });

  test('showHelpMenu=false hides the Help menu but keeps the other menus', () => {
    const toolbar = renderToolbar({ showHelpMenu: false });
    expect(toolbar.queryByRole('button', { name: 'Help' })).toBeNull();
    // The rest of the menu bar is untouched — hiding Help must not collapse the bar.
    expect(toolbar.getByRole('button', { name: 'File' })).toBeTruthy();
    expect(toolbar.getByRole('button', { name: 'Format' })).toBeTruthy();
    expect(toolbar.getByRole('button', { name: 'Insert' })).toBeTruthy();
  });
});
