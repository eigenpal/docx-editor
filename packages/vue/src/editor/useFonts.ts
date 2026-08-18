import { toValue, type MaybeRefOrGetter } from 'vue';
import {
  composeFontConfiguration,
  type FontConfigurationFragment,
  type FontResolutionRequest,
  type FontResolver,
} from '@docx-editor.dev/core/editor';
import type { FontConfiguration } from '@docx-editor.dev/core/contracts/editor';

/** @public */
export type FontsInput =
  | FontConfiguration
  | FontConfigurationFragment
  | FontResolver
  | Promise<FontConfiguration | FontConfigurationFragment | undefined>
  | undefined;

/** @public */
export function useFonts(
  source: MaybeRefOrGetter<FontsInput>,
  ...fragments: MaybeRefOrGetter<FontConfigurationFragment | undefined>[]
): FontResolver {
  const readInputs = () => ({
    source: toValue(source),
    fragments: fragments.map((fragment) => toValue(fragment)),
  });

  const resolver: FontResolver = async (request: FontResolutionRequest) => {
    const current = readInputs();
    const resolved =
      typeof current.source === 'function' ? await current.source(request) : await current.source;
    const origins = [resolved, ...current.fragments].filter(
      (origin): origin is FontConfiguration | FontConfigurationFragment => origin !== undefined
    );
    if (origins.length === 0) return undefined;
    const { epoch: _perLoad, ...merged } = composeFontConfiguration(
      origins[0]!,
      ...origins.slice(1)
    );
    return merged;
  };

  return resolver;
}
