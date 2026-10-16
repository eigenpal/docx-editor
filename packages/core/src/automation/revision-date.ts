/**
 * The current time as a tracked change's `@w:date`: UTC, to the second.
 *
 * Every editor write stamps revisions this way. Automation writes use the same helper, so a
 * change proposed through the editing API saves the same markup as one typed in the editor.
 */
export const revisionDateNow = (): string => `${new Date().toISOString().slice(0, 19)}Z`;
