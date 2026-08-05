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
// Declaring exactly those here, and nothing else, turns an accident of the `lib` setting into the
// actual dependency statement: this code needs a JavaScript engine plus text encoding. Add a name
// to this file and the neutrality claim has been weakened on purpose, in a diff, where it can be
// argued about — which is the point.
//
// `URL` and `AbortSignal` were added when external-image embedding landed, and are argued for on
// the same ground as the encoders: WHATWG globals present in browsers, Node, Bun, Deno and
// workers, absent from `lib.es2022`. `URL` is what makes the external-fetch guard a PARSE rather
// than a regex — it is how `https:`-only, embedded-credential and private-host rejection are
// decided — and `AbortSignal` is the cancellation type those fetches are threaded with. Neither
// names a browser: the DOM is still absent, and a host that lacks them is not one this reader
// can run on anyway.
//
// Only the members the code reads are declared. A wider surface would let more through than the
// dependency actually is.

declare class TextDecoder {
  constructor(label?: string, options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean });
  readonly encoding: string;
  decode(input?: ArrayBuffer | ArrayBufferView): string;
}

declare class TextEncoder {
  readonly encoding: string;
  encode(input?: string): Uint8Array;
}

declare class URL {
  constructor(url: string, base?: string);
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly href: string;
}

declare class AbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  throwIfAborted(): void;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}
