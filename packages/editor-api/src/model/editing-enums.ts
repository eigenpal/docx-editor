/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

/** Locations used by Office-shaped insertion calls. Each call validates its allowed subset. @public */
export enum InsertLocation {
  replace = 'Replace',
  start = 'Start',
  end = 'End',
  before = 'Before',
  after = 'After',
}

/** Paragraph alignment vocabulary. Mixed and unknown are read states, not authoring modes. @public */
export enum Alignment {
  mixed = 'Mixed',
  unknown = 'Unknown',
  left = 'Left',
  centered = 'Centered',
  right = 'Right',
  justified = 'Justified',
}

/** Physical page orientation. @public */
export enum PageOrientation {
  portrait = 'Portrait',
  landscape = 'Landscape',
}

/** Tracking policy vocabulary. Unsupported policies fail explicitly at sync. @public */
export enum ChangeTrackingMode {
  off = 'Off',
  trackAll = 'TrackAll',
  trackMineOnly = 'TrackMineOnly',
}

/** Vertical placement of content within a table cell. Mixed cannot be authored. @public */
export enum VerticalAlignment {
  mixed = 'Mixed',
  top = 'Top',
  center = 'Center',
  bottom = 'Bottom',
}

/** Office break vocabulary; enum presence does not imply support for every break kind. @public */
export enum BreakType {
  line = 'Line',
  page = 'Page',
  next = 'Next',
  sectionNext = 'SectionNext',
  sectionContinuous = 'SectionContinuous',
  sectionEven = 'SectionEven',
  sectionOdd = 'SectionOdd',
}

/** Content-control kinds, including the read subtypes that insertion does not accept. @public */
export enum ContentControlType {
  unknown = 'Unknown',
  richText = 'RichText',
  plainText = 'PlainText',
  picture = 'Picture',
  buildingBlockGallery = 'BuildingBlockGallery',
  checkBox = 'CheckBox',
  comboBox = 'ComboBox',
  datePicker = 'DatePicker',
  dropDownList = 'DropDownList',
  group = 'Group',
  repeatingSection = 'RepeatingSection',
  plainTextInline = 'PlainTextInline',
  plainTextParagraph = 'PlainTextParagraph',
  richTextInline = 'RichTextInline',
  richTextParagraphs = 'RichTextParagraphs',
  richTextTable = 'RichTextTable',
  richTextTableCell = 'RichTextTableCell',
  richTextTableRow = 'RichTextTableRow',
}
