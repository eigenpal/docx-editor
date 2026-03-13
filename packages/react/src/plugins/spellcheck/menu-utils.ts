export type SpellcheckMenuAction = 'replace' | 'ignore' | 'addToDictionary';

export interface SpellcheckMenuItem {
  label: string;
  action: SpellcheckMenuAction;
  value?: string;
}

export function buildSpellcheckMenuItems(suggestions: string[]): SpellcheckMenuItem[] {
  const items: SpellcheckMenuItem[] = suggestions.map((suggestion) => ({
    label: suggestion,
    action: 'replace' as const,
    value: suggestion,
  }));

  items.push({ label: 'Ignore', action: 'ignore' });
  items.push({ label: 'Add to Dictionary', action: 'addToDictionary' });

  return items;
}
