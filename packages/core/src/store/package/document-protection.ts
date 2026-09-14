// What `settings.xml` says about DOCUMENT PROTECTION (`w:documentProtection`, §17.15.1.29).
//
// One reader for the one element, so the mode pill, the Review menu toggle, the store's
// refusals and the tracking settings all answer from the same parse. The element carries
// three separable facts:
//
//   - `@w:edit` (`ST_DocProtect`): WHICH restriction the document asks for — none, read-only,
//     comments only, tracked changes only, or filling in forms.
//   - `@w:enforcement`: whether that restriction is IN FORCE. Word keeps the mode a document
//     was last protected with after Stop Protection, so a file with `w:enforcement="0"` is an
//     ordinary editable document that remembers a preference.
//   - `AG_Password` (`@w:hash`, `@w:salt`, the `crypt*` and `algorithm*` attributes): whether
//     lifting the protection needs a password. The hash is never verified here — protection
//     is advisory, not a security boundary, and the file is editable by anyone holding it —
//     but a protection Word would ask a password for is not one this editor lifts silently.
//
// Reading only. The write is a package-level lifecycle op in `hf-lifecycle.ts`, beside the
// other `settings.xml` write, because it has to land in `CT_Settings` sequence order.

import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';
import { isSettingsElement, settingsAttributeValue, settingsChildNamed } from './settings-onoff.ts';

/** `ST_DocProtect`: the restriction a document asks for. `none` also stands for "no element". */
export type DocumentProtectionEdit = 'none' | 'readOnly' | 'comments' | 'trackedChanges' | 'forms';

/** The document's protection, as the file states it. */
export interface DocumentProtectionState {
  /** The restriction named by `@w:edit`; `none` when absent or unrecognised. */
  readonly edit: DocumentProtectionEdit;
  /** True when `@w:enforcement` puts that restriction in force. Always false for `none`. */
  readonly enforced: boolean;
  /** True when lifting the protection would ask for a password in Word. */
  readonly password: boolean;
}

/** The frozen "not protected" state — what a document with no settings part gets. */
export const NO_DOCUMENT_PROTECTION: DocumentProtectionState = Object.freeze({
  edit: 'none',
  enforced: false,
  password: false,
});

const EDIT_VALUES: ReadonlySet<string> = new Set([
  'none',
  'readOnly',
  'comments',
  'trackedChanges',
  'forms',
]);

/**
 * The `AG_Password` attribute group on `CT_DocProtect`, both the legacy pair and the
 * `crypt*` / `algorithm*` forms Word writes since 2007.
 */
const PASSWORD_ATTRIBUTES: ReadonlySet<string> = new Set([
  'hash',
  'salt',
  'algorithmName',
  'hashValue',
  'saltValue',
  'spinCount',
  'cryptProviderType',
  'cryptAlgorithmClass',
  'cryptAlgorithmType',
  'cryptAlgorithmSid',
  'cryptSpinCount',
  'cryptProvider',
  'algIdExt',
  'algIdExtSource',
  'cryptProviderTypeExt',
  'cryptProviderTypeExtSource',
]);

/** Whether the element carries any password attribute. */
export function protectionHasPassword(element: OoxmlElement): boolean {
  return element.attributes.some(
    (attribute) =>
      PASSWORD_ATTRIBUTES.has(attribute.localName) &&
      attribute.value !== undefined &&
      attribute.value !== ''
  );
}

/**
 * `@w:enforcement` as an `ST_OnOff` attribute: absent means ON.
 *
 * The same reading forms protection has always used, so a document the store refuses to edit
 * outside its form fields is also one this state reports as enforced — the two must not
 * disagree, or the Review menu offers to lift a protection the editor is not applying.
 */
function enforcementOf(element: OoxmlElement): boolean {
  const value = settingsAttributeValue(element, 'enforcement');
  if (value === undefined) return true;
  return value !== '0' && value !== 'false' && value !== 'off';
}

/** Read the protection state from a `settings.xml` root, or "not protected" when it has none. */
export function readDocumentProtection(
  settingsRoot: OoxmlNode | null | undefined
): DocumentProtectionState {
  if (!isSettingsElement(settingsRoot)) return NO_DOCUMENT_PROTECTION;
  const element = settingsChildNamed(settingsRoot, 'documentProtection');
  if (element === null) return NO_DOCUMENT_PROTECTION;
  const rawEdit = settingsAttributeValue(element, 'edit');
  const edit: DocumentProtectionEdit =
    rawEdit !== undefined && EDIT_VALUES.has(rawEdit)
      ? (rawEdit as DocumentProtectionEdit)
      : 'none';
  const password = protectionHasPassword(element);
  if (edit === 'none')
    return password ? { edit, enforced: false, password } : NO_DOCUMENT_PROTECTION;
  return { edit, enforced: enforcementOf(element), password };
}
