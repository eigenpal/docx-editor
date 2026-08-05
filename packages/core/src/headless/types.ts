/** Legacy headless document model types consumed by `@docx-editor.dev/agents`. */

export interface TrackedChangeInfo {
  readonly id: number;
  readonly author: string;
  readonly date?: string;
}

export interface TextContent {
  readonly type: 'text';
  text: string;
  preserveSpace?: boolean;
}

export interface TabContent {
  readonly type: 'tab';
}

export interface BreakContent {
  readonly type: 'break';
  readonly breakType?: 'line' | 'page' | 'column';
}

export type RunContent = TextContent | TabContent | BreakContent;

export interface ColorValue {
  rgb?: string;
  themeColor?: string;
}

export interface FontFamilyValue {
  ascii?: string;
  hAnsi?: string;
}

export interface UnderlineValue {
  style?: 'single' | 'double' | 'thick' | string;
}

export interface TextFormatting {
  bold?: boolean;
  italic?: boolean;
  underline?: UnderlineValue;
  strike?: boolean;
  color?: string | ColorValue;
  highlight?: string;
  fontSize?: number;
  fontFamily?: string | FontFamilyValue;
}

export interface RunPropertyChange {
  readonly type: string;
  readonly info: TrackedChangeInfo;
}

export interface Run {
  readonly type: 'run';
  content: RunContent[];
  formatting?: TextFormatting;
  propertyChanges?: RunPropertyChange[];
}

export interface Hyperlink {
  readonly type: 'hyperlink';
  readonly href?: string;
  readonly anchor?: string;
  children: Run[];
}

export interface Insertion {
  readonly type: 'insertion';
  readonly info: TrackedChangeInfo;
  content: TrackedChangeContent[];
}

export interface Deletion {
  readonly type: 'deletion';
  readonly info: TrackedChangeInfo;
  content: TrackedChangeContent[];
}

export interface MoveFrom {
  readonly type: 'moveFrom';
  readonly info: TrackedChangeInfo;
  content: TrackedChangeContent[];
}

export interface MoveTo {
  readonly type: 'moveTo';
  readonly info: TrackedChangeInfo;
  content: TrackedChangeContent[];
}

export type TrackedChangeContent = Run | Hyperlink | Insertion | Deletion | MoveFrom | MoveTo;

export interface ListRendering {
  level?: number;
  isBullet?: boolean;
}

export interface CommentRangeStart {
  readonly type: 'commentRangeStart';
  id: number;
}

export interface CommentRangeEnd {
  readonly type: 'commentRangeEnd';
  id: number;
}

export type ParagraphContent =
  | Run
  | Hyperlink
  | Insertion
  | Deletion
  | MoveFrom
  | MoveTo
  | CommentRangeStart
  | CommentRangeEnd;

export interface SectionProperties {
  type?: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';
  sectionStart?: 'nextPage' | 'continuous' | 'evenPage' | 'oddPage';
}

export interface ParagraphFormatting {
  styleId?: string;
}

export interface Paragraph {
  readonly type: 'paragraph';
  content: ParagraphContent[];
  formatting?: ParagraphFormatting;
  paraId?: string;
  sectionProperties?: SectionProperties;
  listRendering?: ListRendering;
}

export interface TableCell {
  content: BlockContent[];
}

export interface TableRow {
  cells: TableCell[];
}

export interface Table {
  readonly type: 'table';
  rows: TableRow[];
}

export type BlockContent = Paragraph | Table;

export interface Comment {
  id: number;
  author: string;
  date?: string;
  parentId?: number;
  done?: boolean;
  content: Paragraph[];
}

export interface Footnote {
  id: number;
  content: BlockContent[];
}

export interface Endnote {
  id: number;
  content: BlockContent[];
}

export interface DocumentBody {
  content: BlockContent[];
  comments?: Comment[];
}

export interface StyleInfo {
  styleId: string;
  type?: string;
  name?: string;
}

export interface StyleDefinitions {
  styles?: StyleInfo[];
}

export interface DocxPackage {
  document: DocumentBody;
  footnotes?: Footnote[];
  endnotes?: Endnote[];
  styles?: StyleDefinitions;
}

export interface Document {
  package: DocxPackage;
  originalBuffer?: ArrayBuffer;
  templateVariables?: string[];
  warnings?: string[];
}

export interface ParseOptions {
  readonly preloadFonts?: boolean;
}

export type DocxInput = ArrayBuffer | Uint8Array;
