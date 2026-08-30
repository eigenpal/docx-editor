import type { Plugin } from 'postcss';

/**
 * Removes `@tailwind` at-rules that survive the Tailwind pass.
 *
 * The demos `@import` core's SOURCE `packages/core/src/styles/editor.css`,
 * which carries the shared `@tailwind utilities` directive, and also declare
 * their own. Tailwind v3 expands only the LAST duplicate of a directive and
 * leaves the earlier one in the output verbatim, where the CSS minifier warns
 * (`Unknown at rule: @tailwind`) and the raw directive ships to the browser.
 * The expansion already happened at the surviving directive, so the leftover
 * is dead weight; drop it.
 *
 * Only `@tailwind utilities` is stripped: that is the one directive core's
 * stylesheet shares, so it is the only known-dead duplicate. A surviving
 * `base`/`components` directive means Tailwind did not run at all (missing
 * plugin, broken config path, wrong plugin order), and stripping it would turn
 * that misconfiguration into a silently unstyled build — leave it in so the
 * minifier keeps warning loudly.
 */
export const stripUnexpandedTailwind: Plugin = {
  postcssPlugin: 'strip-unexpanded-tailwind',
  OnceExit(root) {
    root.walkAtRules('tailwind', (atRule) => {
      if (atRule.params.trim() === 'utilities') atRule.remove();
    });
  },
};
