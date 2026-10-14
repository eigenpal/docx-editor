/* eslint-disable react-hooks/rules-of-hooks -- Vue composables in defineComponent setup */
// Compile-time checks for `useOpenFailure().dismiss`: a click handler and a failure both type.
// The Vue tsconfig includes `test`, so `bun run typecheck` fails if either stops compiling.
import { defineComponent, h } from 'vue';
import { useOpenFailure } from '../src/editor/DocxEditorOpenFailure';

export const OpenFailureTypesProbe = defineComponent({
  setup() {
    const { failure, dismiss } = useOpenFailure();
    return () => [
      h('button', { type: 'button', onClick: dismiss }),
      h('button', { type: 'button', onClick: () => dismiss(failure.value ?? undefined) }),
    ];
  },
});
