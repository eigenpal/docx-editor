import { parseInlineStyle } from './clipboard-html-styles.ts';

export type ClipboardNoteKind = 'footnote' | 'endnote';

export interface ClipboardNoteDefinition {
  readonly kind: ClipboardNoteKind;
  readonly id: number;
  readonly element: Element;
}

const NOTE_ID = /^(?:ftn|edn)([1-9]\d{0,4})$/i;

function noteIdOf(raw: string | null): number | null {
  const match = raw === null ? null : NOTE_ID.exec(raw);
  if (!match) return null;
  const id = Number.parseInt(match[1]!, 10);
  return id <= 32_767 ? id : null;
}

export function clipboardNoteReference(
  style: ReadonlyMap<string, string>
): { readonly kind: ClipboardNoteKind; readonly id: number } | null {
  for (const kind of ['footnote', 'endnote'] as const) {
    const raw = style.get(`mso-${kind}-id`);
    const id = noteIdOf(raw ?? null);
    if (id !== null) return { kind, id };
  }
  return null;
}

export function clipboardNoteDefinitions(doc: Document): readonly ClipboardNoteDefinition[] {
  const definitions: ClipboardNoteDefinition[] = [];
  const divs = doc.getElementsByTagName('div');
  for (let index = 0; index < divs.length && definitions.length < 128; index += 1) {
    const element = divs[index]!;
    const msoElement = parseInlineStyle(element).get('mso-element')?.trim().toLowerCase();
    if (msoElement !== 'footnote' && msoElement !== 'endnote') continue;
    const id = noteIdOf(element.getAttribute('id'));
    if (id !== null) definitions.push({ kind: msoElement, id, element });
  }
  return definitions;
}

export function isClipboardNoteList(style: ReadonlyMap<string, string>): boolean {
  const value = style.get('mso-element')?.trim().toLowerCase();
  return value === 'footnote-list' || value === 'endnote-list';
}

export function clipboardNotesPartXml(
  kind: ClipboardNoteKind,
  notes: ReadonlyMap<number, readonly string[]>
): string {
  let inner = '';
  for (const [id, blocks] of notes) {
    inner += `<w:${kind} w:id="${id}">${blocks.join('')}</w:${kind}>`;
  }
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<w:${kind}s xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `${inner}</w:${kind}s>`
  );
}
