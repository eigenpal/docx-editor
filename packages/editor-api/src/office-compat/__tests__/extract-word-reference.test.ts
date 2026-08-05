/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { describe, test, expect } from 'bun:test';
import { extractWordReference } from '../../../scripts/lib/extract-word-reference.mjs';

// A deliberately tiny stand-in for the shape of the real (huge) upstream
// `@types/office-js` declaration file: same syntactic patterns (declaration
// merging across two `declare namespace Word { }` blocks, enum-qualified
// union alternatives collapsing to string literals, JSDoc `[Api set: ...]`
// tags, readonly properties, overloaded methods, a namespace-level
// function), at a size a unit test can own outright instead of depending on
// the multi-megabyte real file.
const SNIPPET = `
declare namespace Word {
    /**
     * Represents the body of a document.
     *
     * @remarks
     * [Api set: WordApi 1.1]
     */
    class Body extends OfficeExtension.ClientObject {
        context: RequestContext;
        /**
         * Gets the text of the body.
         *
         * @remarks
         * [Api set: WordApi 1.1]
         */
        readonly text: string;
        /**
         * Inserts text into the body at the specified location.
         *
         * @remarks
         * [Api set: WordApi 1.1]
         */
        insertText(text: string, insertLocation: Word.InsertLocation.replace | Word.InsertLocation.start | Word.InsertLocation.end | "Replace" | "Start" | "End"): Word.Range;
        /**
         * Clears the contents of the body.
         *
         * @remarks
         * [Api set: WordApi 1.1]
         */
        clear(): void;
        /** Not selected by the manifest; must never appear in output. */
        readonly tables: Word.TableCollection;
    }
}
declare namespace Word {
    /**
     * Executes a batch script against the Word object model.
     */
    function run<T>(batch: (context: Word.RequestContext) => Promise<T>): Promise<T>;
}
`;

describe('extractWordReference', () => {
  test('extracts only manifest-selected symbols and members', () => {
    const result = extractWordReference(SNIPPET, {
      Body: { members: ['text', 'insertText', 'clear'] },
    });
    expect(Object.keys(result)).toEqual(['Body']);
    expect(Object.keys(result.Body.members)).toEqual(['text', 'insertText', 'clear']);
  });

  test('records the upstream UID, kind, and requirement set for a class and its members', () => {
    const result = extractWordReference(SNIPPET, {
      Body: { members: ['text'] },
    });
    expect(result.Body.uid).toBe('Word.Body');
    expect(result.Body.kind).toBe('class');
    expect(result.Body.requirementSet).toBe('WordApi 1.1');
    expect(result.Body.members.text.uid).toBe('Word.Body#text');
    expect(result.Body.members.text.requirementSet).toBe('WordApi 1.1');
  });

  test('marks a readonly property and records its (zero-param) overload', () => {
    const result = extractWordReference(SNIPPET, { Body: { members: ['text'] } });
    expect(result.Body.members.text.kind).toBe('property');
    expect(result.Body.members.text.readonly).toBe(true);
    expect(result.Body.members.text.overloads).toEqual([{ params: [], returns: 'string' }]);
  });

  test('collapses enum-qualified union alternatives to their string-literal form', () => {
    const result = extractWordReference(SNIPPET, { Body: { members: ['insertText'] } });
    const [overload] = result.Body.members.insertText.overloads;
    expect(overload.params[1].type).toBe('"Replace" | "Start" | "End"');
    expect(overload.params[1].type).not.toMatch(/InsertLocation/);
    expect(overload.returns).toBe('Range');
  });

  test('never extracts a member the manifest did not select, even if present upstream', () => {
    const result = extractWordReference(SNIPPET, { Body: { members: ['text'] } });
    expect(result.Body.members.tables).toBeUndefined();
  });

  test('extracts a namespace-level function as its own function-kind symbol', () => {
    const result = extractWordReference(SNIPPET, {
      Body: { members: ['text'] },
      run: { isFunction: true },
    });
    expect(result.run.kind).toBe('function');
    expect(result.run.uid).toBe('Word.run');
    expect(result.run.overloads).toHaveLength(1);
    expect(result.run.overloads[0].returns).toBe('Promise<T>');
  });
});
