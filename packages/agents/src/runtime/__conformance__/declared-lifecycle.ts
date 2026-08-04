// The runtime measured against `compat/docxeditor/declarations.ts`.
//
// Those declarations were authored by hand, from the published Word API surface, without deriving
// anything from a Microsoft package. This file is the other direction of the same claim: that the
// runtime is what they describe. It contains no runtime code — every statement here is an
// assignability question put to the compiler, and `__tests__/runtime-declared-conformance.test.ts`
// compiles it (plus a deliberately wrong copy, so the compiling is known to be load-bearing).
//
// WHAT IS CHECKED is the lifecycle, which is what this slice built:
//
//   `sync(): Promise<void>`      — the batch boundary every authored example awaits
//   `context` on a proxy         — the declared `ClientObject.context`
//   `isNullObject` on a proxy    — the declared `ClientObject.isNullObject`
//   `run(batch) => batch's value`— the declared `run` overloads' call shape
//
// WHAT IS NOT CHECKED YET, and is owed by the object-model slice:
//
//   `RequestContext.document`    — declared as `Document`, which pulls in `Body`, `Paragraph`,
//                                  `Range`, `Font` and the collections. `MiniDocument` in
//                                  `../examples/minimal-model.ts` is a test model of the runtime's
//                                  primitives, deliberately NOT an implementation of `Document`;
//                                  claiming otherwise here would be the compatibility surface
//                                  lying about its own coverage.
//
// The `Declared`/`Mine` naming keeps each assertion readable as a sentence: does mine satisfy the
// declared one, in the position a consumer would use it.

import type { DocxEditor as Declared } from '../../../compat/docxeditor/declarations.ts';
import type { ClientObject } from '../client-object.ts';
import type { RequestContext } from '../request-context.ts';
import type { DocxEditorRuntime } from '../runtime.ts';

/** True only if `A` is usable everywhere `B` is expected. */
type Satisfies<A extends B, B> = A extends B ? true : false;

// The batch boundary. `ClientRequestContext` declares exactly one member, on purpose (see the
// declarations' file header), and it is the one an example awaits.
const syncsLikeTheDeclaredContext: Satisfies<
  Pick<RequestContext, 'sync'>,
  Pick<Declared.ClientRequestContext, 'sync'>
> = true;

// A proxy carries its context and answers whether it turned out to be nothing. Both are declared on
// the base `ClientObject`, so both are checked against the base rather than against a feature type.
const carriesItsContext: Satisfies<
  Pick<ClientObject, 'context'>,
  Pick<Declared.ClientObject, 'context'>
> = true;

const answersIsNullObject: Satisfies<
  Pick<ClientObject, 'isNullObject'>,
  Pick<Declared.ClientObject, 'isNullObject'>
> = true;

// `run` returns what the batch returned. The declared overloads take the object-model
// `RequestContext`, which this slice does not have yet, so the shape is checked with the context
// type substituted — the part that is testable now is that the callback's value comes back out, and
// that it comes back as a promise of exactly that type rather than of `unknown`.
type DeclaredRun<Context> = <T>(batch: (context: Context) => Promise<T>) => Promise<T>;

const runReturnsTheBatchValue: Satisfies<
  DocxEditorRuntime['run'],
  DeclaredRun<RequestContext>
> = true;

// A concrete instance of the shape, so the generic above cannot pass by being vacuous.
declare const runtime: DocxEditorRuntime;
const batchValueSurvives: Promise<number> = runtime.run(async () => 7);

// Nothing is exported: this file is a set of questions for the compiler, not a module anyone imports.
void syncsLikeTheDeclaredContext;
void carriesItsContext;
void answersIsNullObject;
void runReturnsTheBatchValue;
void batchValueSurvives;
