import { expect, test } from 'bun:test';
import {
  readOoxmlPart,
  WML_NAMESPACE_URI,
  OFFICE_MATH_NAMESPACE_URI,
} from '@docx-editor.dev/core/store';
import {
  createFixedMeasurer,
  createUnsupportedContentProjector,
  layoutSemanticDocument,
} from '@docx-editor.dev/core/layout';
import { paintSemanticLayout } from '../semantic-paint.ts';
import {
  observeUnsupportedElements,
  type UnsupportedElementHost,
} from '../unsupported-elements.ts';

function paint(container: HTMLElement, text: string) {
  const result = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:m="${OFFICE_MATH_NAMESPACE_URI}"><w:body>` +
      `<w:p><w:r><w:t>${text}</w:t></w:r><m:oMath>` +
      '<m:unsupported><m:r><m:t>first</m:t></m:r></m:unsupported>' +
      '<m:unsupported><m:r><m:t>second</m:t></m:r></m:unsupported>' +
      '</m:oMath></w:p></w:body></w:document>',
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!result.ok) throw new Error(result.reason);
  paintSemanticLayout(
    container,
    layoutSemanticDocument(result.part, 1, {
      measurer: createFixedMeasurer(6, 14),
    })
  );
}

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

test('distinct equation fallback slots survive repaint and component mutations do not republish', async () => {
  const container = document.createElement('div');
  paint(container, 'before');
  let hosts: readonly UnsupportedElementHost[] = [];
  let publications = 0;
  const stop = observeUnsupportedElements(container, (next) => {
    hosts = next;
    publications++;
  });
  expect(hosts).toHaveLength(2);
  const slots = hosts.map((host) => host.slot);
  expect(slots[0]).not.toBe(slots[1]);
  slots[0]!.textContent = 'Custom first';
  slots[1]!.textContent = 'Custom second';
  await tick();
  expect(publications).toBe(1);
  paint(container, 'after reflow');
  await tick();
  expect(hosts).toHaveLength(2);
  expect(hosts[0]!.slot).toBe(slots[0]);
  expect(hosts[1]!.slot).toBe(slots[1]);
  expect(container.textContent).toContain('Custom first');
  expect(container.textContent).toContain('Custom second');
  expect(publications).toBe(2);
  stop();
  container.replaceChildren();
  await tick();
  expect(publications).toBe(2);
});

test('a focused custom input keeps its focus and text selection across repaint', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  paint(container, 'before');
  let hosts: readonly UnsupportedElementHost[] = [];
  const stop = observeUnsupportedElements(container, (next) => {
    hosts = next;
  });
  const input = document.createElement('input');
  input.value = 'draft preview';
  hosts[0]!.slot.append(input);
  hosts[0]!.setCustomized(true);
  input.focus();
  input.setSelectionRange(2, 6, 'backward');
  paint(container, 'after reflow');
  await tick();
  expect(document.activeElement).toBe(input);
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(6);
  expect(input.selectionDirection).toBe('backward');
  stop();
  container.remove();
});

test('generic opaque source reserves its box and exposes source metadata safely', () => {
  const source = readOoxmlPart(
    `<w:document xmlns:w="${WML_NAMESPACE_URI}" xmlns:x="urn:consumer"><w:body><x:chart/><w:p><w:r><w:t>A</w:t><x:chip/></w:r></w:p></w:body></w:document>`,
    { name: '/word/document.xml', contentType: 'app/xml' }
  );
  if (!source.ok) throw new Error(source.reason);
  const projector = createUnsupportedContentProjector(() => ({ width: 80, height: 36 }));
  const container = document.createElement('div');
  paintSemanticLayout(
    container,
    layoutSemanticDocument(projector.part(source.part), 1, { measurer: createFixedMeasurer(6, 14) })
  );
  let hosts: readonly UnsupportedElementHost[] = [];
  const stop = observeUnsupportedElements(container, (value) => {
    hosts = value;
  });
  expect(hosts.map((host) => host.unsupported.localName)).toEqual(['chart', 'chip']);
  expect(hosts.map((host) => host.unsupported.placement)).toEqual(['block', 'inline']);
  for (const host of hosts) {
    expect(host.unsupported.namespaceUri).toBe('urn:consumer');
    expect(host.unsupported.source?.localName).toBe(host.unsupported.localName);
    expect(host.unsupported.ownerPartName).toBe('/word/document.xml');
    expect(host.unsupported.bounds?.width).toBe(80);
    expect(host.element.getAttribute('contenteditable')).toBe('false');
    host.slot.textContent = 'Custom component';
    host.setCustomized(true);
    expect(host.fallback.hidden).toBe(true);
  }
  stop();
});
