/**
 * Adapted from representative Word JavaScript API proofing samples ("insert annotations",
 * "get annotations", "accept or reject an annotation"), namespace-rewritten `Word` ->
 * `DocxEditor`. A checker reads each paragraph's text, sends it to a service, marks the issues
 * it returns, and later applies or dismisses one. See `insert-text.ts` for why the trailing
 * `context.sync()` call is included.
 */
import { DocxEditor } from '../../docxeditor/declarations';

interface Issue {
  readonly start: number;
  readonly length: number;
  readonly suggestions: string[];
}

declare function check(text: string): Promise<Issue[]>;

export async function markIssues(): Promise<string[]> {
  const ids: string[] = [];
  await DocxEditor.run(async (context) => {
    const paragraphs = context.document.paragraphs;
    await context.sync();

    const results: DocxEditor.ClientResult<string[]>[] = [];
    for (const paragraph of paragraphs.items) {
      const issues = await check(paragraph.text);
      if (issues.length === 0) continue;
      const set: DocxEditor.AnnotationSet = {
        critiques: issues.map((issue) => ({
          colorScheme: 'Red',
          start: issue.start,
          length: issue.length,
          popupOptions: {
            brandingTextResourceId: '',
            subtitleResourceId: '',
            titleResourceId: '',
            suggestions: issue.suggestions,
          },
        })),
      };
      results.push(paragraph.insertAnnotations(set));
    }
    await context.sync();
    for (const result of results) ids.push(...result.value);
  });
  return ids;
}

export async function listIssues(): Promise<string[]> {
  const lines: string[] = [];
  await DocxEditor.run(async (context) => {
    const annotations = context.document.paragraphs.getFirst().getAnnotations();
    await context.sync();
    for (const annotation of annotations.items) {
      const { start, length, colorScheme } = annotation.critiqueAnnotation.critique;
      lines.push(`${annotation.id} ${annotation.state} ${colorScheme} ${start}+${length}`);
    }
    const first = annotations.getFirstOrNullObject();
    await context.sync();
    if (!first.isNullObject) lines.push(first.critiqueAnnotation.range.text);
  });
  return lines;
}

export async function decide(id: string, apply: boolean): Promise<void> {
  await DocxEditor.run(async (context) => {
    const annotation = context.document.getAnnotationById(id);
    if (apply) annotation.critiqueAnnotation.accept();
    else annotation.critiqueAnnotation.reject();
    await context.sync();
  });
}

export async function dismiss(id: string): Promise<void> {
  await DocxEditor.run(async (context) => {
    context.document.getAnnotationById(id).delete();
    context.document.paragraphs.getFirst().getAnnotations().getFirst().delete();
    await context.sync();
  });
}
