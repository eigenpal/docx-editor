/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// `CustomNodeChrome` with inline props, as its example passes them: a host render between
// press and release must not lose the chip click, and the chip styles stay in place.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, expect, test } from 'bun:test';
import { useState } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { CustomNodeChrome } from '../react/index.ts';
import { defineCustomNode } from '../custom-nodes/define-custom-node.ts';

const citation = defineCustomNode({ name: 'citation', tagPrefix: 'acme' });

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
});

function paintChip(): HTMLElement {
  const layer = document.createElement('div');
  layer.className = 'docx-content-control-chrome';
  layer.setAttribute('data-tag', 'acme:citation?sourceId=s1');
  layer.setAttribute('data-docx-content-control', 'c1');
  const boundary = document.createElement('div');
  boundary.className = 'docx-content-control-boundary';
  layer.append(boundary);
  document.body.append(layer);
  return boundary;
}

test('a host render between press and release keeps the chip click', () => {
  const boundary = paintChip();
  const doc = document as unknown as { elementFromPoint: (x: number, y: number) => Element };
  const elementFromPoint = doc.elementFromPoint;
  doc.elementFromPoint = () => boundary;
  try {
    let clicks = 0;
    let bump: () => void = () => {};
    function Host() {
      const [, setCount] = useState(0);
      bump = () => setCount((count) => count + 1);
      return <CustomNodeChrome nodes={[citation]} onNodeClick={() => clicks++} />;
    }
    render(<Host />);
    const style = () =>
      [...document.head.querySelectorAll('style')].find((node) =>
        node.textContent?.includes('docx-content-control-boundary')
      );
    const painted = style();
    expect(painted).toBeDefined();

    boundary.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    act(() => bump());
    boundary.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));

    expect(clicks).toBe(1);
    expect(style()).toBe(painted);
  } finally {
    doc.elementFromPoint = elementFromPoint;
  }
});
