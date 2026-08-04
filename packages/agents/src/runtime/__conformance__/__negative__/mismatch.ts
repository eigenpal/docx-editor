// The control for `../declared-lifecycle.ts`.
//
// A conformance file full of type assertions is worth exactly as much as the compiler's willingness
// to reject a wrong one. This file makes a claim that is FALSE — that the declared request context
// can stand in for this runtime's — and the test next door requires it to fail to compile. If this
// ever compiles, the checks next door have stopped meaning anything and the reason is here, not
// there.

import type { DocxEditor as Declared } from '../../../../compat/docxeditor/declarations.ts';
import type { RequestContext } from '../../request-context.ts';

type Satisfies<A extends B, B> = A extends B ? true : false;

// FALSE: the declared context declares only `sync`. It cannot stand in for the real one, which a
// consumer uses to reach `trackedObjects` and the capabilities of the host it is running on.
const wrongDirection: Satisfies<Declared.ClientRequestContext, RequestContext> = true;

void wrongDirection;
