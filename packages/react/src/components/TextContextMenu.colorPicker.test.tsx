import '../test-utils/happyDomSetup';
import { describe, expect, it, vi } from 'bun:test';
import React from 'react';
import { fireEvent, render } from '@testing-library/react';
import { TextContextMenu, type TextContextMenuItem } from './TextContextMenu';

describe('TextContextMenu color picker', () => {
  it('keeps menu open after color change and closes on blur when value changed', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    const items: TextContextMenuItem[] = [
      {
        action: 'textColor',
        label: 'Text Color',
        submenuVariant: 'colorGrid',
        submenu: [
          {
            action: 'textColor',
            label: 'Custom color',
            isColorPicker: true,
            testId: 'context-textColor-picker',
            value: '#000000',
          },
        ],
        split: true,
        testIdPrefix: 'context-textColor',
      },
    ];

    const { getByTestId } = render(
      React.createElement(TextContextMenu, {
        isOpen: true,
        position: { x: 10, y: 10 },
        hasSelection: true,
        isEditable: true,
        onAction,
        onClose,
        items,
      })
    );

    fireEvent.click(getByTestId('context-textColor-arrow'));

    const input = getByTestId('context-textColor-picker-input') as HTMLInputElement;
    expect(input.tagName).toBe('INPUT');
    expect(input.dataset.lastValue).toBe('#000000');
    fireEvent.focus(input);
    input.value = '#00ff00';
    fireEvent.input(input);

    expect(onAction).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.blur(input);
    expect(onAction).toHaveBeenCalled();
    expect(onAction).toHaveBeenCalledWith('textColor', '#00ff00');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
