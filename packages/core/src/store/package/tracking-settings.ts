// What `settings.xml` says about TRACKING.
//
// Word records the tracking state on the DOCUMENT, not on the session, so a file can arrive
// asking to be edited as tracked changes and a reader that ignores it presents an ordinary
// editable document — and the first keystroke is an untracked edit in a document whose author
// asked for the opposite.
//
// Four settings, and they say different things:
//
//   - `w:trackRevisions` (§17.15.1.90): edits SHOULD be tracked. A request, and the thing the
//     mode control reflects.
//   - `w:documentProtection/@w:edit="trackedChanges"` (§17.15.1.29): editing is PERMITTED only
//     as tracked changes. Stronger — the mode cannot be left. Advisory, never a security
//     boundary: `@w:hash` is not verified here and the file is editable by anyone holding it.
//     Ignoring it silently is what produces untracked edits in a document that forbade them.
//   - `w:doNotTrackMoves` (§17.15.1.51): a move is written as a deletion and an insertion
//     rather than as a `w:moveFrom`/`w:moveTo` pair.
//   - `w:doNotTrackFormatting` (§17.15.1.50): a formatting change is applied with no
//     `w:rPrChange`.
//
// The last two govern WRITING only. A `w:moveFrom` already in a document that declares
// `w:doNotTrackMoves` is still a move: the setting says what a producer emits from now on, not
// how to read what is already there.
//
// Every value is `ST_OnOff` and every element is optional, so absence is the answer rather
// than an error.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

/** What the document asks for. Every field defaults to "the document said nothing". */
export interface DocumentTrackingSettings {
  /** `w:trackRevisions` — the document asks for edits to be tracked. */
  readonly trackRevisions: boolean;
  /**
   * `w:documentProtection/@w:edit="trackedChanges"` — tracking may not be turned OFF.
   *
   * Advisory. Presenting it as enforcement would be a lie about a file anyone can edit.
   */
  readonly restrictedToTrackedChanges: boolean;
  /** `w:doNotTrackMoves` — write a move as a delete and an insert. */
  readonly doNotTrackMoves: boolean;
  /** `w:doNotTrackFormatting` — apply formatting without recording a `w:rPrChange`. */
  readonly doNotTrackFormatting: boolean;
}

export const NO_TRACKING_SETTINGS: DocumentTrackingSettings = Object.freeze({
  trackRevisions: false,
  restrictedToTrackedChanges: false,
  doNotTrackMoves: false,
  doNotTrackFormatting: false,
});

function isElement(node: OoxmlNode | null | undefined): node is OoxmlElement {
  return node !== null && node !== undefined && node.kind !== 'textValue';
}

function childNamed(parent: OoxmlElement, localName: string): OoxmlElement | null {
  for (const child of parent.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return null;
}

function attributeValue(element: OoxmlElement, localName: string): string | undefined {
  for (const attribute of element.attributes) {
    if (attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === localName) {
      return attribute.value;
    }
  }
  return undefined;
}

/**
 * An `ST_OnOff` toggle element: present means on unless `@w:val` spells a false.
 *
 * `<w:trackRevisions w:val="0"/>` means the document asked for tracking to be OFF, and reading
 * the element's mere presence as true would turn it back on.
 */
function onOff(parent: OoxmlElement, localName: string): boolean {
  const element = childNamed(parent, localName);
  if (!element) return false;
  const value = attributeValue(element, 'val');
  if (value === undefined) return true;
  return value !== '0' && value !== 'false' && value !== 'off';
}

/** Read the tracking settings from a `settings.xml` root, or the defaults when it has none. */
export function readTrackingSettings(
  settingsRoot: OoxmlNode | null | undefined
): DocumentTrackingSettings {
  if (!isElement(settingsRoot)) return NO_TRACKING_SETTINGS;
  const protection = childNamed(settingsRoot, 'documentProtection');
  // `@w:edit` is `ST_DocProtect`; only this one value restricts editing to tracked changes.
  // `@w:enforcement` gates whether the protection applies at all — a document can record a
  // protection it is not currently enforcing, and honouring that would lock a document Word
  // lets the user edit freely.
  const enforcement = protection === null ? undefined : attributeValue(protection, 'enforcement');
  const enforcing =
    enforcement !== undefined &&
    enforcement !== '0' &&
    enforcement !== 'false' &&
    enforcement !== 'off';
  return {
    trackRevisions: onOff(settingsRoot, 'trackRevisions'),
    restrictedToTrackedChanges:
      enforcing && protection !== null && attributeValue(protection, 'edit') === 'trackedChanges',
    doNotTrackMoves: onOff(settingsRoot, 'doNotTrackMoves'),
    doNotTrackFormatting: onOff(settingsRoot, 'doNotTrackFormatting'),
  };
}
