// The DocxEditor proxy runtime: `run`, `load`, `sync`.
//
//   const runtime = await DocxEditor.createServer(bytes);
//   await runtime.run(async (context) => {
//     const body = context.document.body;   // the object model arrives in a later slice
//     body.load('text');
//     await context.sync();
//     return body.text;
//   });
//
// This entry — `@docx-editor.dev/agents/runtime` — is the one a server, a worker or a build script
// can import. It reaches the engine only through the neutral automation host, so nothing here needs
// a DOM, a font shaper or a layout pass, and `tsconfig.neutral.json` compiles it with no DOM lib to
// keep that true.
//
// The editor-bound factory lives one subpath further along, at `@docx-editor.dev/agents/runtime/
// browser`, because reaching a live editor means reaching the whole painted engine. A consumer who
// has an editor open is already paying for it; a consumer who has bytes should not.
//
// The published object model, and this runtime taking over the package's root entry, are the
// package-cutover slice. Until then this ships as an additive subpath.

import { createServer } from './server.ts';

export * from './public.ts';

/**
 * The entry point, as much of it as works without an editor.
 *
 * An object rather than a TypeScript `namespace`: a namespace with runtime members is a
 * declaration-merging construct that does not survive being re-exported through a bundler as
 * predictably, and `DocxEditor.createServer` reads the same either way.
 *
 * Import from `@docx-editor.dev/agents/runtime/browser` for the same namespace plus
 * `createBrowser`.
 */
export const DocxEditor = Object.freeze({
  /** A runtime over DOCX bytes. Additionally offers `save()`. */
  createServer,
});
