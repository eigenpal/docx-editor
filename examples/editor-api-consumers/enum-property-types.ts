// Compile-only consumer: CI checks this against both source and published declarations.
// Microsoft declares these properties as enum-or-literal unions on reads AND writes:
// https://learn.microsoft.com/en-us/javascript/api/word/word.document#word-word-document-changetrackingmode-member
// https://learn.microsoft.com/en-us/javascript/api/word/word.pagesetup#word-word-pagesetup-orientation-member
import {
  ChangeTrackingMode,
  PageOrientation,
  type Document,
  type PageSetup,
} from '@docx-editor.dev/editor-api';
import type {
  Document as BrowserDocument,
  PageSetup as BrowserPageSetup,
} from '@docx-editor.dev/editor-api/browser';

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type TrackingProperty = ChangeTrackingMode | 'Off' | 'TrackAll' | 'TrackMineOnly';
type OrientationProperty = PageOrientation | 'Portrait' | 'Landscape';

// Reject both enum-only narrowing and widening to arbitrary strings, on both entry points.
export type OfficeEnumPropertyContract = [
  Assert<Same<Document['changeTrackingMode'], TrackingProperty>>,
  Assert<Same<PageSetup['orientation'], OrientationProperty>>,
  Assert<Same<BrowserDocument['changeTrackingMode'], TrackingProperty>>,
  Assert<Same<BrowserPageSetup['orientation'], OrientationProperty>>,
];

// TypeScript checks these call sites; this function is never executed. Enum presence
// does not promise runtime support for every value (TrackAll still refuses at sync).
export function enumPropertyConsumer(document: Document, pageSetup: PageSetup): void {
  // Consumers preserve the complete Office.js property type with indexed access.
  const mode: Document['changeTrackingMode'] = document.changeTrackingMode;
  const orientation: PageSetup['orientation'] = pageSetup.orientation;
  document.changeTrackingMode = mode;
  pageSetup.orientation = orientation;

  document.changeTrackingMode = ChangeTrackingMode.off;
  document.changeTrackingMode = ChangeTrackingMode.trackAll;
  document.changeTrackingMode = ChangeTrackingMode.trackMineOnly;
  document.changeTrackingMode = 'Off';
  document.changeTrackingMode = 'TrackAll';
  document.changeTrackingMode = 'TrackMineOnly';
  pageSetup.orientation = PageOrientation.portrait;
  pageSetup.orientation = PageOrientation.landscape;
  pageSetup.orientation = 'Portrait';
  pageSetup.orientation = 'Landscape';

  // Enum comparisons remain available without asserting the read to an enum-only type.
  const trackingMine: boolean = mode === ChangeTrackingMode.trackMineOnly;
  const landscape: boolean = orientation === PageOrientation.landscape;
  void [trackingMine, landscape];

  // @ts-expect-error Office.js rejects arbitrary tracking strings.
  document.changeTrackingMode = 'Enabled';
  // @ts-expect-error Office.js orientation literals are case-sensitive.
  pageSetup.orientation = 'landscape';
}
