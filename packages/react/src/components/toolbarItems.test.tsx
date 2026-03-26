import '../test-utils/happyDomSetup';
import React from 'react';
import { describe, it, expect, vi } from 'bun:test';
import { render } from '@testing-library/react';
import { ColorHistoryProvider } from './ColorHistoryContext';
import { useToolbarItems, type RibbonButtonItem } from './toolbarItems';

const colorHistoryValue = {
  lastTextColor: { auto: true },
  lastHighlightColor: 'none',
  setLastTextColor: () => {},
  setLastHighlightColor: () => {},
};

function findRibbonButton(
  ribbon: ReturnType<typeof useToolbarItems>['ribbon'],
  id: string
): RibbonButtonItem | undefined {
  for (const tab of ribbon) {
    for (const group of tab.groups) {
      for (const item of group.items) {
        if (item.kind === 'button' && item.id === id) {
          return item as RibbonButtonItem;
        }
      }
    }
  }
  return undefined;
}

describe('useToolbarItems (footnotes)', () => {
  it('wires insert footnote/endnote actions', () => {
    const onInsertFootnote = vi.fn();
    const onInsertEndnote = vi.fn();
    let footnoteButton: RibbonButtonItem | undefined;
    let endnoteButton: RibbonButtonItem | undefined;

    function Harness() {
      const { ribbon } = useToolbarItems({ onInsertFootnote, onInsertEndnote });
      footnoteButton = findRibbonButton(ribbon, 'insertFootnote');
      endnoteButton = findRibbonButton(ribbon, 'insertEndnote');
      return null;
    }

    render(
      React.createElement(
        ColorHistoryProvider,
        { value: colorHistoryValue },
        React.createElement(Harness)
      )
    );

    expect(footnoteButton).toBeTruthy();
    expect(endnoteButton).toBeTruthy();

    footnoteButton?.onClick?.();
    endnoteButton?.onClick?.();

    expect(onInsertFootnote).toHaveBeenCalledTimes(1);
    expect(onInsertEndnote).toHaveBeenCalledTimes(1);
  });
});
