/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What "neutral" actually requires of a host, spelled out.
//
// `tsconfig.neutral.json` gives its program the ES language library and NOTHING else, which is how
// a DOM reference in the lifecycle becomes a compile error. But the bounded package reader the
// automation host sits on decodes bytes, and `TextDecoder`/`TextEncoder` are WHATWG globals rather
// than ECMAScript ones: present in browsers, in Node, in Bun, in Deno, in workers — absent from
// `lib.es2022`.
//
// Declaring exactly those two here, and nothing else, turns an accident of the `lib` setting into
// the actual dependency statement: this code needs a JavaScript engine plus text encoding. Add a
// third name to this file and the neutrality claim has been weakened on purpose, in a diff, where
// it can be argued about — which is the point.

declare class TextDecoder {
  constructor(label?: string, options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean });
  readonly encoding: string;
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}
