/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { afterEach, expect, test } from 'bun:test';
import { planRevisionBatch, serializeOoxmlPart, stylesPartOf } from '@docx-editor.dev/core/store';
import { commitSessionTreeOpsAtomic } from '../../../../core/src/binding/tree-session-apply.ts';
import { createPeerHarness, zipDocument, W, R, REL } from './document-peer-support.ts';
const peers = createPeerHarness('shared-style-revisions');
afterEach(() => peers.cleanup());
for (const action of ['accept', 'reject'] as const) {
  test(`${action}: story and style decisions replay, reload and undo together`, async () => {
    const bytes = zipDocument(
      '<w:p><w:ins w:id="1" w:author="Ada"><w:r><w:t>body</w:t></w:r></w:ins></w:p>',
      {
        overrides:
          '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
        documentRels: `<Relationships xmlns="${REL}"><Relationship Id="rStyles" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
        extraXml: {
          'word/styles.xml': `<w:styles xmlns:w="${W}"><w:style w:styleId="Normal" w:type="paragraph"><w:name w:val="Normal"/><w:rPr><w:b/><w:rPrChange w:id="1" w:author="Ada"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr></w:style></w:styles>`,
        },
      }
    );
    const { alice, bob } = await peers.pair(bytes);
    const styles = stylesPartOf(alice.store.currentPackage())!;
    const before = serializeOoxmlPart(styles);
    const stylePlan = planRevisionBatch(styles, action);
    const bodyPlan = planRevisionBatch(alice.store.bodyStore().part, action);
    expect(
      commitSessionTreeOpsAtomic(alice.store, [{ scope: { kind: 'body' }, ops: bodyPlan.ops }], {
        partOps: [{ partName: styles.name, ops: stylePlan.ops }],
      }).committed
    ).toBe(true);
    alice.port.flushPendingJournals();
    peers.expectConverged(alice, bob);
    const after = serializeOoxmlPart(stylesPartOf(bob.store.currentPackage())!);
    expect(after).not.toContain('rPrChange');
    expect(after).toContain(action === 'accept' ? '<w:b' : '<w:i');
    expect(alice.room.session.undo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(stylesPartOf(bob.store.currentPackage())!)).toBe(before);
    expect(alice.room.session.redo()).toBe(true);
    peers.expectConverged(alice, bob);
    expect(serializeOoxmlPart(stylesPartOf(bob.store.currentPackage())!)).toBe(after);
  });
}
