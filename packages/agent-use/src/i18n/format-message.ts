/**
 * Tiny ICU-subset formatter shared by agent-use's React + Vue components
 * for falling back on bundled English defaults. Same shape as React's
 * `useTranslation` formatMessage.
 *
 * Supports: `{name}` interpolation + `{count, plural, =N {...} one {# ...} other {# ...}}`.
 */

function parseBranches(branchStr: string): Record<string, string> {
  const parsed: Record<string, string> = {};
  const regex = /(=\d+|\w+)\s*\{([^}]*)\}/g;
  let match;
  while ((match = regex.exec(branchStr)) !== null) {
    parsed[match[1]] = match[2];
  }
  return parsed;
}

export function formatMessage(
  template: string,
  vars?: Record<string, string | number>,
  lang = 'en'
): string {
  if (!vars) return template;

  const result = template.replace(
    /\{(\w+),\s*plural,\s*((?:[^{}]|\{[^{}]*\})*)\}/g,
    (full, varName, branchStr) => {
      const count = Number(vars[varName]);
      if (isNaN(count)) return full;
      const parsed = parseBranches(branchStr);
      const exact = parsed[`=${count}`];
      if (exact !== undefined) return exact.replace(/#/g, String(count));
      let category: string;
      try {
        category = new Intl.PluralRules(lang).select(count);
      } catch {
        category = count === 1 ? 'one' : 'other';
      }
      const text = parsed[category] ?? parsed['other'] ?? '';
      return text.replace(/#/g, String(count));
    }
  );

  return result.replace(/\{(\w+)\}/g, (_, key) => {
    const val = vars[key];
    return val !== undefined ? String(val) : `{${key}}`;
  });
}
