/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The compact rail's floating card uses the SAME card template as the List.
//
// A narrow gutter switches the rail to compact: markers in a strip and one floating card
// for the active item. That card once read the root's loose children and ignored the List
// part, so a host that hid packaged parts inside the List and added its own components
// saw the packaged reply box come back, and its own components vanish, whenever the
// window narrowed.
//
// These tests paint through the BUILT react adapter (`@docx-editor.dev/react` resolves to
// packages/react/dist) — rebuild it before trusting a failure.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import type { ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import { reviewModule } from '../index.ts';
import { DocxEditorReview, useReviewItem } from '../react/index.ts';
import { strToU8, zipSync } from 'fflate';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const COMMENTS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments';

/** One paragraph with one open comment over its text. */
const COMMENTED_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>' +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}"><w:body><w:p><w:commentRangeStart w:id="7"/>` +
      '<w:r><w:t>hello</w:t></w:r><w:commentRangeEnd w:id="7"/>' +
      '<w:r><w:commentReference w:id="7"/></w:r></w:p></w:body></w:document>'
  ),
  'word/comments.xml': strToU8(
    `<w:comments xmlns:w="${W}"><w:comment w:id="7" w:author="Ada">` +
      '<w:p><w:r><w:t>Check this.</w:t></w:r></w:p></w:comment></w:comments>'
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rIdC" Type="${COMMENTS_REL}" Target="comments.xml"/></Relationships>`
  ),
});

// happy-dom lays nothing out. A 1000px scroller is too narrow for the full column beside
// a 100% page, so the rail goes compact; `offsetParent` lets the rail place its card.
let widthDescriptor: PropertyDescriptor | undefined;
let offsetDescriptor: PropertyDescriptor | undefined;

beforeAll(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  offsetDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetParent');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.parentElement;
    },
  });
});

afterAll(() => {
  if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
  else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  if (offsetDescriptor) {
    Object.defineProperty(HTMLElement.prototype, 'offsetParent', offsetDescriptor);
  } else {
    delete (HTMLElement.prototype as { offsetParent?: Element | null }).offsetParent;
  }
});

afterEach(cleanup);

async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function waitFor(predicate: () => boolean, attempts = 40): Promise<void> {
  for (let i = 0; i < attempts && !predicate(); i++) await settle(25);
}

function HostThread() {
  const item = useReviewItem();
  return <div data-testid="host-thread">{item?.text}</div>;
}

async function openCompactCard(review: ReactNode): Promise<HTMLElement> {
  const view = render(
    <DocxEditorRoot document={COMMENTED_SOURCE} modules={[reviewModule()]}>
      <DocxEditorViewport>
        <DocxEditorContent />
        {review}
      </DocxEditorViewport>
    </DocxEditorRoot>
  );
  const rail = () => view.container.querySelector('[data-testid="review-rail"]');
  await waitFor(() => rail()?.hasAttribute('data-compact') === true);
  expect(rail()?.hasAttribute('data-compact')).toBe(true);
  await waitFor(() => view.container.querySelector('[data-testid="review-marker"]') !== null);
  const marker = view.container.querySelector('[data-testid="review-marker"]') as HTMLButtonElement;
  expect(marker).toBeTruthy();
  act(() => {
    marker.click();
  });
  const card = () =>
    view.container.querySelector('[data-testid="review-compact-card"]') as HTMLElement | null;
  await waitFor(() => card() !== null);
  expect(card()).not.toBeNull();
  return card()!;
}

describe('the compact card', () => {
  test('the packaged card shows its reply box when the host supplies no template', async () => {
    // The control: the active packaged card carries the reply box, so its absence in the
    // next test comes from the host's hidden part, not from the fixture.
    const card = await openCompactCard(<DocxEditorReview />);
    expect(card.querySelector('[data-testid="review-reply-input"]')).not.toBeNull();
  });

  test('renders the List part overrides and host children', async () => {
    const card = await openCompactCard(
      <DocxEditorReview card={{ className: 'host-card' }}>
        <DocxEditorReview.List>
          <DocxEditorReview.Replies hidden />
          <DocxEditorReview.Reply hidden />
          <HostThread />
        </DocxEditorReview.List>
        <DocxEditorReview.Markers />
      </DocxEditorReview>
    );
    expect(card.querySelector('[data-testid="host-thread"]')?.textContent).toBe('Check this.');
    expect(card.querySelector('[data-testid="review-reply-input"]')).toBeNull();
    expect(card.querySelector('[data-testid="review-card"]')?.classList.contains('host-card')).toBe(
      true
    );
  });

  test('uses a List render prop', async () => {
    const card = await openCompactCard(
      <DocxEditorReview>
        <DocxEditorReview.List>
          {(item) => <div data-testid="host-render">{item.text}</div>}
        </DocxEditorReview.List>
        <DocxEditorReview.Markers />
      </DocxEditorReview>
    );
    expect(card.querySelector('[data-testid="host-render"]')?.textContent).toBe('Check this.');
    expect(card.querySelector('[data-testid="review-card"]')).toBeNull();
  });
});
