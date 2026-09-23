// Which stops a numbering suffix tab may use: a document setting, carried on tab stops.
//
// `w:doNotUseIndentAsNumberingTabStop` (§17.15.3) lives in `settings.xml`, outside every
// paragraph's property chain. The style cascade reads it once, and each paragraph's
// resolved stops carry it, so the tab-stop cache token covers it with no extra key.

import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import type { ResolvedTabStops } from './paragraph-tabs.ts';

/** The settings-derived part of the numbering-tab rule. */
export interface NumberingTabSettings {
  readonly ignoreIndentAsNumberingTabStop?: true;
}

function wordChild(parent: OoxmlElement, localName: string): OoxmlElement | undefined {
  for (const child of parent.children) {
    if (child.kind === 'textValue') continue;
    if (child.namespaceUri === WML_NAMESPACE_URI && child.localName === localName) return child;
  }
  return undefined;
}

/**
 * Read `w:settings/w:compat/w:doNotUseIndentAsNumberingTabStop`. An absent `w:val` means
 * on; `0`, `false` and `off` mean off, like every other `ST_OnOff` value.
 */
export function numberingTabSettings(settings: OoxmlElement | null): NumberingTabSettings {
  if (!settings || settings.namespaceUri !== WML_NAMESPACE_URI) return {};
  if (settings.localName !== 'settings') return {};
  const compat = wordChild(settings, 'compat');
  const element = compat && wordChild(compat, 'doNotUseIndentAsNumberingTabStop');
  if (!element) return {};
  const value = element.attributes.find(
    (attribute) => attribute.namespaceUri === WML_NAMESPACE_URI && attribute.localName === 'val'
  )?.value;
  const on = value === undefined || value === '1' || value === 'true' || value === 'on';
  return on ? { ignoreIndentAsNumberingTabStop: true } : {};
}

/**
 * Republish a paragraph's stops under the document's numbering-tab rule. Returns the input
 * unchanged under the default rule, so the cache token stays the same.
 */
export function withNumberingTabRule(
  tabs: ResolvedTabStops,
  settings: NumberingTabSettings | undefined
): ResolvedTabStops {
  if (!settings?.ignoreIndentAsNumberingTabStop || tabs.ignoreIndentAsNumberingTabStop) {
    return tabs;
  }
  return { ...tabs, ignoreIndentAsNumberingTabStop: true };
}
