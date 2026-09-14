// Word's Protect Document, at the store: reading `w:documentProtection`, writing it in schema
// order, refusing to lift a password, and the read-only / comments-only refusals.

import { describe, expect, test } from 'bun:test';
import { strToU8, zipSync } from 'fflate';
import {
  applyHeaderFooterLifecycleOp,
  readDocumentProtection,
  readOoxmlPackage,
  readTrackingSettings,
  serializeOoxmlPart,
  type OoxmlPackage,
} from '../index.ts';
import { documentProtectionRefusal } from '../store/forms-protection.ts';
import { TreePackageStore } from '../store/tree-package-store.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';

function build(settingsInner: string | null): OoxmlPackage {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (settingsInner === null
          ? ''
          : '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${REL}">` +
        (settingsInner === null
          ? ''
          : `<Relationship Id="rIdSet" Type="${R}/settings" Target="settings.xml"/>`) +
        '</Relationships>'
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Body</w:t></w:r></w:p></w:body></w:document>`
    ),
  };
  if (settingsInner !== null) {
    entries['word/settings.xml'] = strToU8(
      `<w:settings xmlns:w="${W}">${settingsInner}</w:settings>`
    );
  }
  const result = readOoxmlPackage(zipSync(entries));
  if (!result.ok) throw new Error(result.reason);
  return result.package;
}

const settingsXml = (pkg: OoxmlPackage): string =>
  serializeOoxmlPart(pkg.parts.get('/word/settings.xml')!);
const settingsRoot = (pkg: OoxmlPackage) => pkg.parts.get('/word/settings.xml')?.root ?? null;

function apply(pkg: OoxmlPackage, enforce: boolean): OoxmlPackage {
  const result = applyHeaderFooterLifecycleOp(pkg, { op: 'setDocumentProtection', enforce });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return result.package;
}

function refuse(pkg: OoxmlPackage, enforce: boolean): string {
  const result = applyHeaderFooterLifecycleOp(pkg, { op: 'setDocumentProtection', enforce });
  if (result.ok) throw new Error('expected a refusal');
  return `${result.reason}:${result.detail ?? ''}`;
}

const FORMS = '<w:documentProtection w:edit="forms" w:enforcement="1"/>';
const PASSWORD =
  '<w:documentProtection w:edit="forms" w:enforcement="1" w:cryptProviderType="rsaAES" ' +
  'w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="14" ' +
  'w:cryptSpinCount="100000" w:hash="abc=" w:salt="def="/>';

describe('reading document protection', () => {
  test('no settings part, no element, and an unenforced element are all "not protected"', () => {
    expect(readDocumentProtection(settingsRoot(build(null)))).toEqual({
      edit: 'none',
      enforced: false,
      password: false,
    });
    expect(readDocumentProtection(settingsRoot(build(''))).enforced).toBe(false);
    const lifted = readDocumentProtection(
      settingsRoot(build('<w:documentProtection w:edit="forms" w:enforcement="0"/>'))
    );
    expect(lifted).toEqual({ edit: 'forms', enforced: false, password: false });
  });

  test('every ST_DocProtect value reads back, and an unknown one reads as none', () => {
    for (const edit of ['readOnly', 'comments', 'trackedChanges', 'forms'] as const) {
      const state = readDocumentProtection(
        settingsRoot(build(`<w:documentProtection w:edit="${edit}" w:enforcement="1"/>`))
      );
      expect(state).toEqual({ edit, enforced: true, password: false });
    }
    expect(
      readDocumentProtection(
        settingsRoot(build('<w:documentProtection w:edit="everything" w:enforcement="1"/>'))
      ).edit
    ).toBe('none');
  });

  test('a password is reported, never verified', () => {
    expect(readDocumentProtection(settingsRoot(build(PASSWORD)))).toEqual({
      edit: 'forms',
      enforced: true,
      password: true,
    });
  });

  test('the tracking settings see enforced forms protection', () => {
    expect(readTrackingSettings(settingsRoot(build(FORMS))).restrictedToForms).toBe(true);
    expect(
      readTrackingSettings(
        settingsRoot(build('<w:documentProtection w:edit="forms" w:enforcement="0"/>'))
      ).restrictedToForms
    ).toBe(false);
    expect(readTrackingSettings(settingsRoot(build(''))).restrictedToForms).toBe(false);
  });
});

describe('the setDocumentProtection op', () => {
  test('enforcing writes forms protection in CT_Settings order', () => {
    const pkg = build(
      '<w:zoom w:percent="100"/><w:trackRevisions/><w:defaultTabStop w:val="720"/>'
    );
    const out = settingsXml(apply(pkg, true));
    const protection = out.indexOf('<w:documentProtection');
    expect(protection).toBeGreaterThan(out.indexOf('<w:trackRevisions'));
    expect(protection).toBeLessThan(out.indexOf('<w:defaultTabStop'));
    expect(out).toContain('w:edit="forms"');
    expect(out).toContain('w:enforcement="1"');
    expect(readDocumentProtection(settingsRoot(apply(pkg, true)))).toEqual({
      edit: 'forms',
      enforced: true,
      password: false,
    });
  });

  test('enforcing lands first when nothing precedes it, and creates a missing settings part', () => {
    const out = settingsXml(apply(build('<w:defaultTabStop w:val="720"/>'), true));
    expect(out.indexOf('<w:documentProtection')).toBeLessThan(out.indexOf('<w:defaultTabStop'));
    const created = apply(build(null), true);
    expect(readDocumentProtection(settingsRoot(created)).enforced).toBe(true);
  });

  test('lifting keeps the recorded mode and clears the enforcement, as Stop Protection does', () => {
    const out = settingsXml(apply(build(FORMS), false));
    expect(out).toContain('w:edit="forms"');
    expect(out).toContain('w:enforcement="0"');
    expect(readDocumentProtection(settingsRoot(apply(build(FORMS), false)))).toEqual({
      edit: 'forms',
      enforced: false,
      password: false,
    });
  });

  test('lifting any enforced mode works; re-enforcing replaces it with forms', () => {
    const readOnly = build('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>');
    expect(readDocumentProtection(settingsRoot(apply(readOnly, false)))).toEqual({
      edit: 'readOnly',
      enforced: false,
      password: false,
    });
    expect(readDocumentProtection(settingsRoot(apply(readOnly, true)))).toEqual({
      edit: 'forms',
      enforced: true,
      password: false,
    });
  });

  test('enforcing drops the password a lifted protection left behind', () => {
    const lifted = build(PASSWORD.replace('w:enforcement="1"', 'w:enforcement="0"'));
    const out = settingsXml(apply(lifted, true));
    expect(out).not.toContain('w:hash');
    expect(out).not.toContain('cryptProviderType');
    expect(readDocumentProtection(settingsRoot(apply(lifted, true))).password).toBe(false);
  });

  test('a password-protected document refuses to lift', () => {
    expect(refuse(build(PASSWORD), false)).toBe('invalidArgs:password');
  });

  test('a write that changes nothing is refused rather than recorded', () => {
    expect(refuse(build(FORMS), true)).toBe('invalidArgs:no-change');
    expect(refuse(build(''), false)).toBe('invalidArgs:no-change');
  });

  test('the package store commits it as one undoable package unit', () => {
    const pkg = build('');
    const store = new TreePackageStore(pkg, pkg.parts.get(pkg.mainDocumentPart)!);
    const result = store.applyLifecycleOp({ op: 'setDocumentProtection', enforce: true });
    expect(result.ok).toBe(true);
    expect(readDocumentProtection(settingsRoot(store.currentPackage())).enforced).toBe(true);
    expect(store.undo()).not.toBeNull();
    expect(readDocumentProtection(settingsRoot(store.currentPackage())).enforced).toBe(false);
    expect(store.redo()).not.toBeNull();
    expect(readDocumentProtection(settingsRoot(store.currentPackage())).enforced).toBe(true);
  });
});

describe('read-only and comments-only refusals', () => {
  const settings = (inner: string) => build(inner).parts.get('/word/settings.xml');
  const insert = { op: 'insertText', paragraphId: 'p', offset: 0, text: 'x' } as const;
  const marker = {
    op: 'insertCommentMarker',
    paragraphId: 'p',
    start: 0,
    end: 1,
    commentId: '1',
  } as const;

  test('read-only refuses every op', () => {
    const readOnly = settings('<w:documentProtection w:edit="readOnly" w:enforcement="1"/>');
    expect(documentProtectionRefusal(readOnly, insert)).toBe('locked');
    expect(documentProtectionRefusal(readOnly, marker as never)).toBe('locked');
  });

  test('comments-only admits the comment anchor and refuses the rest', () => {
    const comments = settings('<w:documentProtection w:edit="comments" w:enforcement="1"/>');
    expect(documentProtectionRefusal(comments, insert)).toBe('locked');
    expect(documentProtectionRefusal(comments, marker as never)).toBeNull();
  });

  test('forms, tracked changes, lifted and absent protection are answered elsewhere', () => {
    for (const inner of [
      FORMS,
      '<w:documentProtection w:edit="trackedChanges" w:enforcement="1"/>',
      '<w:documentProtection w:edit="readOnly" w:enforcement="0"/>',
      '',
    ]) {
      expect(documentProtectionRefusal(settings(inner), insert)).toBeNull();
    }
    expect(documentProtectionRefusal(null, insert)).toBeNull();
  });
});
