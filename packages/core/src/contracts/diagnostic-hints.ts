import type { DiagnosticCode } from './diagnostics.ts';

/**
 * What a diagnostic code means and what to do about it.
 *
 * Both strings are constants written for developers. They never contain document content, so
 * an exporter can send them with the event.
 *
 * @public
 */
export interface DiagnosticExplanation {
  /** One or two sentences: the cause, then the action. */
  readonly hint: string;
  /** The documentation section for this code. */
  readonly docs: string;
}

const DOCS = 'https://docx-editor.dev/docs/2.x/guides/diagnostics';
/** The docs section of each code family; `open.zip-corrupt` is in `#open`. */
const SECTIONS = { open: 'open', edit: 'edit', review: 'review', font: 'font' } as const;

/**
 * A `Record` over the whole union, so a new code without a hint fails the type check.
 * Kept in English: these are developer messages, not interface strings.
 */
const HINTS: Readonly<Record<DiagnosticCode, string>> = {
  'open.unsupported-source':
    "The editor was given something that is not DOCX bytes. Pass a Uint8Array or an ArrayBuffer of a .docx file, or 'blank'.",
  'open.zip-corrupt':
    'The file is not a valid ZIP archive, or a compressed entry is damaged. Ask for a fresh copy of the file.',
  'open.zip-invalid-entry-name':
    'The archive contains an entry with an unsafe path, such as ".." or a leading "/". The editor refuses it for safety.',
  'open.zip-entry-limit':
    'The archive has more entries than the open limit allows. For a trusted file, the server API accepts a higher limit: limits.zip.maxEntries in createServer.',
  'open.zip-size-limit':
    'The archive expands to more than the total size limit. For a trusted file, the server API accepts a higher limit: limits.zip.maxTotalBytes in createServer.',
  'open.zip-ratio-limit':
    'The file expands to many times its compressed size, which is how a decompression bomb looks. For a trusted file, the server API accepts a higher limit: limits.zip.maxRatio in createServer.',
  'open.xml-malformed':
    'An XML part of the document is not well formed. Opening and saving the file in a desktop editor usually repairs it.',
  'open.xml-dtd-forbidden':
    'An XML part declares a DTD or an entity. The editor refuses these to block XML entity attacks.',
  'open.xml-part-size-limit':
    'One XML part is larger than the per-part size limit. For a trusted file, the server API accepts a higher limit: limits.xml.maxBytes in createServer.',
  'open.xml-depth-limit':
    'An XML part nests deeper than the depth limit, often through deeply nested tables. This limit is fixed; flatten the nesting to open the file.',
  'open.xml-element-limit':
    'An XML part has more elements than the element limit. For a trusted file, the server API accepts a higher limit: limits.xml.maxElements in createServer.',
  'open.invalid-limits':
    'The limits passed to createServer are not valid numbers. Check the limits option.',
  'open.content-types-invalid':
    'The file has no valid [Content_Types].xml part, so it is not a usable Office package. Save it again as .docx.',
  'open.missing-main-document':
    'The package has no main document part. The file may be a different Office format, such as .xlsx or .pptx, renamed to .docx.',
  'open.relationships-invalid':
    'A relationship in the package is invalid or duplicated. Opening and saving the file in a desktop editor usually repairs it.',
  'open.relationship-limit':
    'The package has more relationships than the open limit allows. For a trusted file, the server API accepts a higher limit: limits.maxRelationships in createServer.',
  'open.part-limit':
    'The package has more XML parts than the open limit allows. For a trusted file, the server API accepts a higher limit: limits.maxXmlParts in createServer.',
  'open.failed':
    'The document could not be opened for a reason without a specific code. Report it with the engine version.',

  'edit.read-only':
    'The document is open for viewing or is protected as read-only, so edits are refused. Change the editing mode, or remove the protection.',
  'edit.protected-content':
    'The edit touches content that document protection or a locked content control does not allow you to change.',
  'edit.suggesting-needs-author':
    'Suggesting (tracking changes) needs an author to attribute each change to. Pass the author option or call setAuthor.',
  'edit.review-module-required':
    'This operation needs the review module. Register reviewModule() from @docx-editor.dev/pro in modules.',
  'edit.tracked-drawing-delete-unsupported':
    'Deleting a drawing is not supported while changes are tracked. Delete the text around it, or switch tracking off for this edit.',
  'edit.tracked-structure-unsupported':
    'This structural edit cannot be recorded as a tracked change. Make it with tracking off, or edit the text inside the structure instead.',
  'edit.revision-unsupported':
    'The edit overlaps a tracked change of a kind the editor cannot change. Accept or reject that change first.',
  'edit.cross-structure-join':
    'The edit would join paragraphs that live in different containers, such as two table cells. Edit each container separately.',
  'edit.indivisible-content':
    'The edit would split content that must stay whole, such as an equation or a field. Select the whole item instead.',
  'edit.field-structure':
    'The edit would break the structure of a field. Edit the field result as a whole, or remove the whole field.',
  'edit.section-mark':
    'The edit would remove a section break that holds page layout settings. Remove the section break on its own.',
  'edit.table-structure-unsupported':
    'The table edit is not supported for this table shape, for example a table with merged cells. Change the merge first.',
  'edit.table-insert-refused':
    'A table cannot be inserted at the selection, for example inside a field or a locked content control. Move the caret first.',
  'edit.table-of-contents-refused':
    'The table of contents could not be inserted or updated at this place. Check that the selection is in the main document body.',
  'edit.unsupported-content':
    'The edit touches content the editor shows but cannot change yet. The content is kept as it is.',
  'edit.unsupported-story':
    'This part of the document, such as a header, a footer or a note, does not support this edit.',
  'edit.unmapped-change':
    'The browser changed the page in a way the editor could not express as a document edit, so the change was undone.',
  'edit.stale-target':
    'The edit addresses content that no longer exists, usually after a remote or undone change. Read the document again and retry.',
  'edit.invalid-argument':
    'The command arguments are not valid for this target. Check the command type and its fields.',
  'edit.resource-limit':
    'The edit would exceed a size or nesting limit. Split the change into smaller edits.',
  'edit.refresh-in-progress':
    'An external document refresh is in progress. Retry the edit after the refresh completes.',
  'edit.internal-invariant':
    'The editor refused an edit to protect the document structure. This is an engine defect: report the code with the engine version.',
  'edit.refused':
    'The edit was refused for a reason without a specific code. Read snapshot().lastRejection for the local message.',

  'review.revision-unsupported':
    'A tracked change of this kind cannot be accepted or rejected yet. It was left in the document.',
  'review.incomplete-group':
    'The tracked change is part of a group that was not fully selected. Select the whole group, or resolve it from the review pane.',
  'review.retained-structure':
    'Resolving the tracked change would remove structure that other content still needs, so it was left in place.',
  'review.stale-revision':
    'The tracked change no longer exists, usually because it was resolved already. Read the review items again.',

  'font.shaper-unavailable':
    'The text shaper did not load, so text is measured with fallback metrics. Check that your bundler serves the HarfBuzz WebAssembly file.',
  'font.load-failed':
    'A font face could not be loaded. The editor uses a substitute. Check the font source URL and its CORS headers.',
  'font.missing':
    'A font the document asks for is not available. The editor uses a substitute. Add the face to the fonts option.',
  'font.integrity-mismatch':
    'A font face does not match its declared hash or metadata, so the editor refused it and used a substitute.',
  'font.malformed':
    'A font file is not a valid font, so the editor refused it and used a substitute. Check the file the font source points at.',
  'font.size-limit':
    'A font file is larger than the font byte budget, so the editor used a substitute. Subset the font, or serve a smaller face.',
  'font.unsupported-face':
    'A font face uses a format or face index the editor does not support. The editor uses a substitute.',
};

/**
 * What a diagnostic code means and what to do about it.
 *
 * @example
 * ```ts
 * editor.on('diagnostic', (event) => {
 *   if (event.kind === 'edit.rejected') console.warn(explainDiagnostic(event.code).hint);
 * });
 * ```
 *
 * @public
 */
export function explainDiagnostic(code: DiagnosticCode): DiagnosticExplanation {
  const family = code.slice(0, code.indexOf('.')) as keyof typeof SECTIONS;
  return { hint: HINTS[code] ?? HINTS['edit.refused'], docs: `${DOCS}#${SECTIONS[family]}` };
}

/** Every public code, in declaration order. For coverage tests and catalogs. @public */
export function diagnosticCodes(): readonly DiagnosticCode[] {
  return Object.keys(HINTS) as DiagnosticCode[];
}
