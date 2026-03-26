import { describe, it, expect, vi } from 'bun:test';
import { ribbonActions } from './ribbonActions';

describe('ribbonActions (backfill)', () => {
  it('acceptAllChanges triggers handler', () => {
    const onAcceptAllChanges = vi.fn();
    ribbonActions.acceptAllChanges({ onAcceptAllChanges });
    expect(onAcceptAllChanges).toHaveBeenCalledTimes(1);
  });

  it('rejectAllChanges triggers handler', () => {
    const onRejectAllChanges = vi.fn();
    ribbonActions.rejectAllChanges({ onRejectAllChanges });
    expect(onRejectAllChanges).toHaveBeenCalledTimes(1);
  });

  it('updateTOC triggers handler', () => {
    const onUpdateTOC = vi.fn();
    ribbonActions.updateTOC({ onUpdateTOC });
    expect(onUpdateTOC).toHaveBeenCalledTimes(1);
  });
});

describe('ribbonActions (missing commands)', () => {
  it('margins triggers page setup handler', () => {
    const onPageSetup = vi.fn();
    ribbonActions.margins({ onPageSetup });
    expect(onPageSetup).toHaveBeenCalledTimes(1);
  });

  it('orientation triggers page setup handler', () => {
    const onPageSetup = vi.fn();
    ribbonActions.orientation({ onPageSetup });
    expect(onPageSetup).toHaveBeenCalledTimes(1);
  });

  it('size triggers page setup handler', () => {
    const onPageSetup = vi.fn();
    ribbonActions.size({ onPageSetup });
    expect(onPageSetup).toHaveBeenCalledTimes(1);
  });

  it('image width opens image size dialog', () => {
    const onOpenImageSize = vi.fn();
    ribbonActions.imageWidth({ onOpenImageSize });
    expect(onOpenImageSize).toHaveBeenCalledTimes(1);
  });

  it('image height opens image size dialog', () => {
    const onOpenImageSize = vi.fn();
    ribbonActions.imageHeight({ onOpenImageSize });
    expect(onOpenImageSize).toHaveBeenCalledTimes(1);
  });

  it('aspect ratio opens image size dialog', () => {
    const onOpenImageSize = vi.fn();
    ribbonActions.aspectRatio({ onOpenImageSize });
    expect(onOpenImageSize).toHaveBeenCalledTimes(1);
  });

  it('new comment triggers handler', () => {
    const onNewComment = vi.fn();
    ribbonActions.newComment({ onNewComment });
    expect(onNewComment).toHaveBeenCalledTimes(1);
  });

  it('delete comment triggers handler', () => {
    const onDeleteComment = vi.fn();
    ribbonActions.deleteComment({ onDeleteComment });
    expect(onDeleteComment).toHaveBeenCalledTimes(1);
  });

  it('insert footnote triggers handler', () => {
    const onInsertFootnote = vi.fn();
    ribbonActions.insertFootnote({ onInsertFootnote });
    expect(onInsertFootnote).toHaveBeenCalledTimes(1);
  });

  it('insert endnote triggers handler', () => {
    const onInsertEndnote = vi.fn();
    ribbonActions.insertEndnote({ onInsertEndnote });
    expect(onInsertEndnote).toHaveBeenCalledTimes(1);
  });
});
