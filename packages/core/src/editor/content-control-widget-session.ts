import type { OoxmlElement, OoxmlNode } from '@docx-editor.dev/core/store';
import type { ContentControlWidgetSession } from './popup-sessions.ts';

interface Host {
  find(id: string): OoxmlElement | null;
  allowed(id: string): boolean;
  apply(id: string, value: string): boolean;
  items(id: string): readonly { displayText: string; value: string }[];
  date(id: string): string | undefined;
  layer: HTMLElement;
  setOpen(id: string, open: boolean): void;
  request?: ((session: ContentControlWidgetSession) => boolean) | undefined;
}
function valueText(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  if (node.localName === 'sdtPr') return '';
  return node.children.map(valueText).join('');
}
function kindOf(control: OoxmlElement | null): string | undefined {
  const properties = control?.children.find(
    (node) => node.kind !== 'textValue' && node.localName === 'sdtPr'
  );
  if (!properties || properties.kind === 'textValue') return;
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName === 'dropDownList') return 'dropdown';
    if (child.localName === 'comboBox' || child.localName === 'date') return child.localName;
  }
}
/** Typed host sessions over the existing content-control command lane. */
export function createContentControlWidgetSessions(host: Host) {
  let active: { controller: AbortController; id: string } | null = null;
  let destroyed = false;
  const cancel = () => {
    const previous = active;
    active = null;
    if (!previous) return;
    host.setOpen(previous.id, false);
    previous.controller.abort();
  };
  return {
    cancel,
    destroy() {
      destroyed = true;
      cancel();
    },
    open(id: string, kind: string): boolean {
      cancel();
      if (destroyed || !host.request || !['dropdown', 'comboBox', 'date'].includes(kind))
        return false;
      const controller = new AbortController();
      active = { controller, id };
      const isActive = () =>
        !destroyed && active?.controller === controller && !controller.signal.aborted;
      const canApply = () => isActive() && kindOf(host.find(id)) === kind && host.allowed(id);
      const control = host.find(id);
      const items = host.items(id).map((item) => ({ ...item }));
      const displayed = control ? valueText(control) : '';
      const value = items.find((item) => item.displayText === displayed)?.value ?? displayed;
      const session: ContentControlWidgetSession = {
        controlId: id,
        kind: kind as ContentControlWidgetSession['kind'],
        items,
        value: kind === 'date' ? (host.date(id) ?? '') : value,
        anchor:
          [...host.layer.querySelectorAll<HTMLElement>('[data-docx-content-control]')].find(
            (node) => node.getAttribute('data-docx-content-control') === id
          ) ?? null,
        signal: controller.signal,
        canApply,
        apply(value) {
          if (!canApply() || !host.apply(id, value)) return false;
          if (isActive()) cancel();
          return true;
        },
        cancel() {
          if (isActive()) cancel();
        },
      };
      host.setOpen(id, true);
      if (host.request(session)) return true;
      session.cancel();
      return false;
    },
  };
}

export function contentControlWidgetItems(
  control: OoxmlElement | null
): readonly { displayText: string; value: string }[] {
  if (!control) return [];
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if (
      (child as { kind?: string }).kind !== 'contentControlProperties' &&
      child.localName !== 'sdtPr'
    ) {
      continue;
    }
    for (const prop of child.children) {
      if (prop.kind === 'textValue') continue;
      if (prop.localName !== 'dropDownList' && prop.localName !== 'comboBox') continue;
      const items: { displayText: string; value: string }[] = [];
      for (const item of prop.children) {
        if (item.kind === 'textValue' || item.localName !== 'listItem') continue;
        const value = item.attributes.find((a) => a.localName === 'value')?.value ?? '';
        const displayText =
          item.attributes.find((a) => a.localName === 'displayText')?.value ?? value;
        items.push({ displayText, value });
      }
      return items;
    }
  }
  return [];
}

export function contentControlWidgetDate(control: OoxmlElement | null): string | undefined {
  if (!control) return undefined;
  for (const child of control.children) {
    if (child.kind !== 'contentControlProperties') continue;
    for (const property of child.children) {
      if (property.kind !== 'contentControlDate') continue;
      return property.attributes.find((attribute) => attribute.localName === 'fullDate')?.value;
    }
  }
  return undefined;
}
