import { strToU8, zipSync } from 'fflate';
import { docx } from './fixtures';

export const DROPDOWN_SOURCE = docx(
  '<w:tbl><w:tblPr><w:tblW w:type="dxa" w:w="4800"/></w:tblPr>' +
    '<w:tblGrid><w:gridCol w:w="2400"/><w:gridCol w:w="2400"/></w:tblGrid>' +
    '<w:tr><w:tc><w:p><w:r><w:t>First cell</w:t></w:r></w:p></w:tc>' +
    '<w:tc><w:p><w:r><w:t>Second cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>' +
    '<w:p><w:r><w:t>After the table</w:t></w:r></w:p>'
);

export const DROPDOWN_SLOTS = [
  'alignment',
  'list.lineSpacing',
  'table.borderTarget',
  'table.borderStyle',
  'table.borderWidth',
] as const;

export const POPUP_SELECTOR =
  '.docx-toolbar__alignment-popup, .docx-toolbar__line-spacing-menu, .docx-table-chrome__panel';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const MAIN = 'application/vnd.openxmlformats-officedocument.wordprocessingml';

/** A body paragraph with a footnote reference, in a section with a default header. */
export const MODES_SOURCE = zipSync({
  '[Content_Types].xml': strToU8(
    `<Types xmlns="${CT}">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      `<Override PartName="/word/document.xml" ContentType="${MAIN}.document.main+xml"/>` +
      `<Override PartName="/word/header1.xml" ContentType="${MAIN}.header+xml"/>` +
      `<Override PartName="/word/footnotes.xml" ContentType="${MAIN}.footnotes+xml"/>` +
      '</Types>'
  ),
  '_rels/.rels': strToU8(
    `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
  ),
  'word/_rels/document.xml.rels': strToU8(
    `<Relationships xmlns="${REL}">` +
      `<Relationship Id="rIdH" Type="${R}/header" Target="header1.xml"/>` +
      `<Relationship Id="rIdF" Type="${R}/footnotes" Target="footnotes.xml"/>` +
      '</Relationships>'
  ),
  'word/document.xml': strToU8(
    `<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>` +
      '<w:p><w:r><w:t>Body text</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rIdH"/></w:sectPr>' +
      '</w:body></w:document>'
  ),
  'word/header1.xml': strToU8(
    `<w:hdr xmlns:w="${W}"><w:p><w:r><w:t>Header text</w:t></w:r></w:p></w:hdr>`
  ),
  'word/footnotes.xml': strToU8(
    `<w:footnotes xmlns:w="${W}">` +
      '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>' +
      '<w:footnote w:id="1"><w:p><w:r><w:footnoteRef/><w:t>Note text</w:t></w:r></w:p></w:footnote>' +
      '</w:footnotes>'
  ),
});

/** Dispatch an Escape keydown and return it, so a test can read its outcome. */
export function pressEscape(target: EventTarget, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
}

export function trackDocumentKeydown(doc: Document) {
  const listeners = new Set<EventListenerOrEventListenerObject>();
  const add = doc.addEventListener,
    remove = doc.removeEventListener;
  doc.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) {
    if (type === 'keydown') listeners.add(listener);
    add.call(doc, type, listener, options);
  };
  doc.removeEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ) {
    if (type === 'keydown') listeners.delete(listener);
    remove.call(doc, type, listener, options);
  };
  return {
    listeners,
    restore() {
      doc.addEventListener = add;
      doc.removeEventListener = remove;
    },
  };
}
