/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterAll, expect, test } from 'bun:test';
import { strToU8, strFromU8, unzipSync, zipSync } from 'fflate';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
const registered = !GlobalRegistrator.isRegistered;
if (registered) GlobalRegistrator.register();
afterAll(() => {
  if (registered) GlobalRegistrator.unregister();
});
import { createDocxEditor } from '@docx-editor.dev/core/editor';
import { DocxEditor, RemoveDocInfoType } from '@docx-editor.dev/editor-api';
import { DocxEditor as BrowserDocxEditor } from '@docx-editor.dev/editor-api/browser';
import { propertyRemovalDocument, PROPERTY_PARTS } from './support/property-removal-document.ts';
import { docx, p } from './support/documents.ts';
import reference from '../../../compat/reference/word.full-inventory.json';

function checkRemoved(bytes: Uint8Array) {
  const files = unzipSync(bytes);
  for (const name of PROPERTY_PARTS) expect(files[name]).toBeUndefined();
  expect(strFromU8(files['_rels/.rels']!)).not.toContain('properties');
  expect(strFromU8(files['[Content_Types].xml']!)).not.toContain('properties');
  expect(strFromU8(files['word/document.xml']!)).toContain('Retain private body text');
  expect(files['word/media/retained.bin']).toEqual(new Uint8Array([1, 2, 3, 4]));
}

test('server removes core, extended and custom properties and exposes readonly lastAuthor', async () => {
  const runtime = await DocxEditor.createServer(propertyRemovalDocument());
  try {
    await runtime.run(async (context) => {
      const properties = context.document.properties;
      expect(() => properties.lastAuthor).toThrow();
      properties.load('lastAuthor');
      await context.sync();
      expect(properties.lastAuthor).toBe('Last editor');
      expect(
        Object.getOwnPropertyDescriptor(Object.getPrototypeOf(properties), 'lastAuthor')!.set
      ).toBeUndefined();
      context.document.removeDocumentInformation(RemoveDocInfoType.documentProperties);
      await context.sync();
      properties.load('author,lastAuthor');
      await context.sync();
      expect([properties.author, properties.lastAuthor]).toEqual(['', '']);
    });
    checkRemoved(await runtime.save());
    const reopened = await DocxEditor.createServer(await runtime.save());
    try {
      checkRemoved(await reopened.save());
    } finally {
      reopened.dispose();
    }
  } finally {
    runtime.dispose();
  }
});

test('browser removal saves and undoes as one edit', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const editor = createDocxEditor({ container, document: propertyRemovalDocument() });
  const runtime = BrowserDocxEditor.createBrowser(editor);
  try {
    const before = new Uint8Array(await editor.save());
    await runtime.run(async (context) => {
      context.document.removeDocumentInformation('DocumentProperties');
      await context.sync();
    });
    checkRemoved(new Uint8Array(await editor.save()));
    expect(editor.exec({ type: 'undo' }).ok).toBe(true);
    expect(new Uint8Array(await editor.save())).toEqual(before);
    expect(editor.exec({ type: 'redo' }).ok).toBe(true);
    checkRemoved(new Uint8Array(await editor.save()));
  } finally {
    runtime.dispose();
    editor.destroy();
    container.remove();
  }
});

test('other removal modes, tracked removal, and mixed write batches refuse atomically', async () => {
  const runtime = await DocxEditor.createServer(propertyRemovalDocument(), { author: 'Reviewer' });
  try {
    const before = await runtime.save();
    for (const mode of Object.values(RemoveDocInfoType)) {
      if (mode === RemoveDocInfoType.documentProperties) continue;
      await expect(
        runtime.run(async (c) => {
          c.document.removeDocumentInformation(mode);
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await runtime.save()).toEqual(before);
    }
    await expect(
      runtime.run(async (c) => {
        c.document.changeTrackingMode = 'TrackMineOnly';
        c.document.removeDocumentInformation('DocumentProperties');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    await expect(
      runtime.run(async (c) => {
        c.document.properties.title = 'Changed';
        c.document.removeDocumentInformation('DocumentProperties');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'ConflictingChanges' });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

for (const kind of [
  'duplicate',
  'wrongType',
  'wrongRoot',
  'unknownIncoming',
  'outgoing',
] as const) {
  test(`unsafe property removal refuses ${kind}`, async () => {
    const files = unzipSync(propertyRemovalDocument());
    if (kind === 'duplicate')
      files['_rels/.rels'] = strToU8(
        strFromU8(files['_rels/.rels']!).replace(
          '</Relationships>',
          '<Relationship Id="duplicate" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'
        )
      );
    if (kind === 'wrongType')
      files['[Content_Types].xml'] = strToU8(
        strFromU8(files['[Content_Types].xml']!).replace(
          'application/vnd.openxmlformats-package.core-properties+xml',
          'application/xml'
        )
      );
    if (kind === 'wrongRoot') files['docProps/core.xml'] = strToU8('<Other xmlns="urn:unknown"/>');
    if (kind === 'unknownIncoming')
      files['_rels/.rels'] = strToU8(
        strFromU8(files['_rels/.rels']!).replace(
          '</Relationships>',
          '<Relationship Id="unknown" Type="urn:retained" Target="docProps/core.xml"/></Relationships>'
        )
      );
    if (kind === 'outgoing')
      files['docProps/_rels/core.xml.rels'] = strToU8(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="retained" Type="urn:unknown" Target="../word/document.xml"/></Relationships>'
      );
    const runtime = await DocxEditor.createServer(zipSync(files));
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (c) => {
          c.document.removeDocumentInformation('DocumentProperties');
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}

test('missing properties make removal a successful no-op', async () => {
  const runtime = await DocxEditor.createServer(docx(p('Body')));
  try {
    const before = await runtime.save();
    await runtime.run(async (c) => {
      c.document.removeDocumentInformation('DocumentProperties');
      await c.sync();
    });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

test('removal preserves foreign content-type elements and namespaced attributes', async () => {
  const files = unzipSync(propertyRemovalDocument());
  files['[Content_Types].xml'] = strToU8(
    strFromU8(files['[Content_Types].xml']!).replace(
      '</Types>',
      '<x:Override xmlns:x="urn:retained" PartName="/docProps/core.xml">Keep foreign entry</x:Override><Override xmlns:x="urn:retained" x:PartName="/docProps/core.xml" PartName="/retained.xml" ContentType="application/xml"/></Types>'
    )
  );
  files['retained.xml'] = strToU8('<retained/>');
  const runtime = await DocxEditor.createServer(zipSync(files));
  try {
    await runtime.run(async (c) => {
      c.document.removeDocumentInformation('DocumentProperties');
      await c.sync();
    });
    const saved = unzipSync(await runtime.save());
    expect(strFromU8(saved['[Content_Types].xml']!)).toContain('Keep foreign entry');
    expect(strFromU8(saved['[Content_Types].xml']!)).toContain('/retained.xml');
    expect(saved['retained.xml']).toBeDefined();
    expect(saved['docProps/core.xml']).toBeUndefined();
  } finally {
    runtime.dispose();
  }
});

test('removal refuses an extended property relationship without losing its attributes', async () => {
  const files = unzipSync(propertyRemovalDocument());
  files['_rels/.rels'] = strToU8(
    strFromU8(files['_rels/.rels']!).replace(
      'Id="property0"',
      'xmlns:x="urn:retained" x:keep="Retain" Id="property0"'
    )
  );
  const runtime = await DocxEditor.createServer(zipSync(files));
  try {
    const before = await runtime.save();
    await expect(
      runtime.run(async (c) => {
        c.document.removeDocumentInformation('DocumentProperties');
        await c.sync();
      })
    ).rejects.toMatchObject({ code: 'NotSupported' });
    expect(await runtime.save()).toEqual(before);
  } finally {
    runtime.dispose();
  }
});

test('RemoveDocInfoType exposes every pinned enum value', () => {
  const expected = Object.fromEntries(
    reference.endpoints
      .filter((row) => row.uid.startsWith('Word.RemoveDocInfoType.'))
      .map((row) => [
        row.uid.slice('Word.RemoveDocInfoType.'.length),
        'value' in row ? row.value : undefined,
      ])
  );
  expect(RemoveDocInfoType).toEqual(expected);
});

for (const extension of ['attribute', 'child'] as const) {
  test(`removal refuses property content-type ${extension} extensions atomically`, async () => {
    const files = unzipSync(propertyRemovalDocument());
    const beforeXml = strFromU8(files['[Content_Types].xml']!);
    const changed =
      extension === 'attribute'
        ? beforeXml.replace(
            'PartName="/docProps/core.xml"',
            'xmlns:x="urn:retained" x:keep="Retain" PartName="/docProps/core.xml"'
          )
        : beforeXml.replace(
            'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
            'ContentType="application/vnd.openxmlformats-package.core-properties+xml"><x:keep xmlns:x="urn:retained">Retain</x:keep></Override>'
          );
    expect(changed).not.toBe(beforeXml);
    files['[Content_Types].xml'] = strToU8(changed);
    const runtime = await DocxEditor.createServer(zipSync(files));
    try {
      const before = await runtime.save();
      await expect(
        runtime.run(async (c) => {
          c.document.removeDocumentInformation('DocumentProperties');
          await c.sync();
        })
      ).rejects.toMatchObject({ code: 'NotSupported' });
      expect(await runtime.save()).toEqual(before);
    } finally {
      runtime.dispose();
    }
  });
}
