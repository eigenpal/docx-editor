// Content-control surface chrome: boundary furniture, show-all, form-fill navigation,
// lock/bound refusals, and remove — without layout reflow.

import { GlobalRegistrator } from '@happy-dom/global-registrator';
if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

import { describe, expect, test } from 'bun:test';
import { zipSync, strToU8 } from 'fflate';
import { mountPaginatedSurface, type PaginatedSurface } from '../paginated-surface.ts';
import { paintSemanticLayout } from '@docx-editor.dev/core/output';
import { createFixedMeasurer, layoutSemanticDocument } from '@docx-editor.dev/core/layout';
import { readOoxmlPart } from '@docx-editor.dev/core/store';
import { CHROME_GROUPS, chromeSlotId, type ChromeSlotId } from '../chrome-controls.ts';
import { commandForSlot } from '../toolbar-commands.ts';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const OD = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const W14 = 'http://schemas.microsoft.com/office/word/2010/wordml';

function docx(body: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${REL}"><Relationship Id="rId1" Type="${OD}" Target="word/document.xml"/></Relationships>`
    ),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${W}" xmlns:w14="${W14}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const p = (text: string) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const sdt = (pr: string, content: string) =>
  `<w:sdt><w:sdtPr>${pr}</w:sdtPr><w:sdtContent>${content}</w:sdtContent></w:sdt>`;

function mount(body: string): { surface: PaginatedSurface; container: HTMLElement } {
  const container = document.createElement('div');
  const result = mountPaginatedSurface(container, docx(body), { scale: 1 });
  if (!result.ok) throw new Error(`${result.reason}: ${result.detail ?? ''}`);
  return { surface: result.surface, container };
}

function putCaret(surface: PaginatedSurface, offset: number, paragraphIndex = 0): void {
  const paragraphId = surface.session.paragraphIds()[paragraphIndex]!;
  surface.setSelection({
    anchor: { paragraphId, offset },
    head: { paragraphId, offset },
  });
}

function pageGeometry(surface: PaginatedSurface) {
  return surface.layout().pages.map((page) => ({
    w: page.box.width,
    h: page.box.height,
    cw: page.contentBox.width,
    ch: page.contentBox.height,
    fragments: page.fragments.length,
  }));
}

describe('content-control surface chrome', () => {
  test('chrome slots are registered without renaming existing slots', () => {
    const slots: ChromeSlotId[] = CHROME_GROUPS.flatMap((g) =>
      g.controls.map((c) => chromeSlotId(g, c))
    );
    expect(slots).toContain('contentControl.showAll');
    expect(slots).toContain('contentControl.formFill');
    expect(slots).toContain('contentControl.inspector');
    expect(slots).toContain('contentControl.remove');
    expect(slots).toContain('text.bold');
    expect(CHROME_GROUPS.find((group) => group.id === 'contentControl')?.contextual).toBe(true);
    expect(commandForSlot('contentControl.remove')).toEqual({ type: 'removeContentControl' });
    expect(commandForSlot('contentControl.showAll')).toBeNull();
  });

  test('show-all paints boundary furniture without reflow', () => {
    const { surface, container } = mount(
      sdt(`<w:alias w:val="Name"/><w:text/>`, p('Ada')) + p('after')
    );
    expect(surface.layout().contentControls?.length).toBeGreaterThan(0);
    // Park the caret outside every control so only show-all (not caret-entry) paints chrome.
    putCaret(surface, 0, 1);
    expect(surface.contentControls.atCaret()).toBeNull();
    expect(
      container
        .querySelector<HTMLElement>('[data-docx-content-control]')!
        .hasAttribute('data-boundary-visible')
    ).toBe(false);

    const before = pageGeometry(surface);

    surface.contentControls.setShowAll(true);
    expect(surface.state().contentControls.showAll).toBe(true);
    expect(pageGeometry(surface)).toEqual(before);

    const chrome = container.querySelector('[data-docx-content-control]');
    expect(chrome).toBeTruthy();
    expect(chrome!.getAttribute('contenteditable')).toBe('false');
    expect(chrome!.hasAttribute('data-docx-marker')).toBe(true);

    surface.contentControls.setShowAll(false);
    expect(
      container
        .querySelector<HTMLElement>('[data-docx-content-control]')!
        .hasAttribute('data-boundary-visible')
    ).toBe(false);
    expect(pageGeometry(surface)).toEqual(before);
  });

  test('caret entry shows chrome for the active control only', () => {
    const { surface, container } = mount(
      sdt(`<w:alias w:val="A"/><w:text/>`, p('one')) +
        sdt(`<w:alias w:val="B"/><w:text/>`, p('two'))
    );
    putCaret(surface, 1, 0);
    expect(surface.contentControls.atCaret()?.alias).toBe('A');
    const nodes = [...container.querySelectorAll('[data-docx-content-control]')];
    expect(nodes.length).toBe(2);
    const active = nodes.find((node) => (node as HTMLElement).hasAttribute('data-active'));
    expect((active as HTMLElement | undefined)?.dataset.alias).toBe('A');
  });

  test('widget mousedown is prevented so chrome does not steal the caret', () => {
    const body = `<w:p>${sdt(
      `<w:dropDownList><w:listItem w:displayText="One" w:value="1"/></w:dropDownList>`,
      `<w:r><w:t>One</w:t></w:r>`
    )}</w:p>`;
    const { surface, container } = mount(body);
    putCaret(surface, 0);
    surface.contentControls.setShowAll(true);
    const widget = container.querySelector('[data-docx-cc-widget]') as HTMLElement | null;
    expect(widget).toBeTruthy();
    const before = surface.state().selection;
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
      clientX: 0,
      clientY: 0,
    });
    widget!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(surface.state().selection).toEqual(before);
  });

  test('widget menus open below controls in pages-layer coordinates', () => {
    const body =
      `<w:p>${sdt(
        `<w:dropDownList><w:listItem w:displayText="One" w:value="1"/>` +
          `<w:listItem w:displayText="Two" w:value="2"/></w:dropDownList>`,
        `<w:r><w:t>One</w:t></w:r>`
      )}</w:p>` +
      `<w:p>${sdt(
        `<w:date w:fullDate="2026-08-04T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>`,
        `<w:r><w:t>2026-08-04</w:t></w:r>`
      )}</w:p>`;
    const { surface, container } = mount(body);
    const records = surface.layout().contentControls!;
    const widgets = [...container.querySelectorAll<HTMLElement>('[data-docx-cc-widget]')].sort(
      (left) => (left.dataset.docxCcWidget === 'date' ? -1 : 1)
    );
    expect(widgets).toHaveLength(2);

    for (const [index, widget] of widgets.entries()) {
      widget.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: index + 1,
          pointerType: 'mouse',
        })
      );
      const menu = container.querySelector<HTMLElement>('.docx-content-control-menu');
      expect(menu).not.toBeNull();
      const controlId = widget.getAttribute('data-docx-cc-id');
      const fragment = records.find((record) => record.id === controlId)!.fragments[0]!;
      const page = surface.layout().pages[fragment.pageIndex]!;
      // Compared as numbers: CSS serializes to six decimals, so a coordinate that is a
      // repeating decimal never matches its own `${value}px` spelling.
      expect(Number.parseFloat(menu!.style.left)).toBeCloseTo(
        page.box.x + (page.contentBox.x - page.box.x) + fragment.box.x + fragment.box.width,
        5
      );
      expect(Number.parseFloat(menu!.style.top)).toBeCloseTo(
        page.box.y + (page.contentBox.y - page.box.y) + fragment.box.y + fragment.box.height,
        5
      );
      expect(menu!.style.transform).toBe('translateX(-100%)');
      if (widget.dataset.docxCcWidget === 'date') {
        expect(menu!.classList.contains('docx-content-control-calendar')).toBe(true);
        expect(menu!.querySelectorAll('.docx-content-control-calendar-day')).toHaveLength(42);
        expect(menu!.querySelector('input[type="date"]')).not.toBeNull();
      }
      const owner = [
        ...container.querySelectorAll<HTMLElement>('[data-docx-content-control]'),
      ].find((chrome) => chrome.getAttribute('data-docx-content-control') === controlId);
      expect(owner?.hasAttribute('data-open')).toBe(true);
      if (widget.dataset.docxCcWidget === 'dropdown') {
        const option = menu!.querySelectorAll<HTMLElement>('.docx-content-control-menu-item')[1]!;
        const pointerDown = new PointerEvent('pointerdown', {
          bubbles: true,
          cancelable: true,
          button: 0,
          pointerId: 10,
          pointerType: 'mouse',
        });
        option.dispatchEvent(pointerDown);
        expect(pointerDown.defaultPrevented).toBe(false);
        option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        expect(menu!.isConnected).toBe(false);
        expect(container.querySelector('.docx-page-content')?.textContent).toContain('Two');
      } else {
        const beforeTitle = menu!.querySelector(
          '.docx-content-control-calendar-title'
        )?.textContent;
        const next = menu!.querySelectorAll<HTMLElement>('.docx-content-control-calendar-nav')[1]!;
        next.dispatchEvent(
          new PointerEvent('pointerdown', {
            bubbles: true,
            cancelable: true,
            button: 0,
            pointerId: 11,
            pointerType: 'mouse',
          })
        );
        next.click();
        expect(menu!.querySelector('.docx-content-control-calendar-title')?.textContent).not.toBe(
          beforeTitle
        );
        expect(menu!.querySelector('.docx-content-control-calendar-input')).not.toBeNull();
        document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        expect(menu!.isConnected).toBe(false);
      }
    }
  });

  test('manual calendar entry commits an ISO date', () => {
    const body = `<w:p>${sdt(
      `<w:date w:fullDate="2026-08-04T00:00:00Z"><w:dateFormat w:val="yyyy-MM-dd"/></w:date>`,
      `<w:r><w:t>2026-08-04</w:t></w:r>`
    )}</w:p>`;
    const { container } = mount(body);
    const widget = container.querySelector<HTMLElement>('[data-docx-cc-widget="date"]')!;
    widget.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 12,
        pointerType: 'mouse',
      })
    );
    const manual = container.querySelector<HTMLInputElement>(
      '.docx-content-control-calendar-input'
    )!;
    manual.value = '2026-09-15';
    manual.dispatchEvent(new InputEvent('input', { bubbles: true }));
    manual.dispatchEvent(new Event('change', { bubbles: true }));
    expect(container.querySelector('.docx-content-control-menu')).not.toBeNull();
    manual.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    expect(container.querySelector('.docx-content-control-menu')).toBeNull();
    expect(container.querySelector('.docx-page-content')?.textContent).toContain('2026-09-15');
  });

  test('boundary furniture is excluded from native selection mapping', () => {
    const part = readOoxmlPart(
      `<w:document xmlns:w="${W}"><w:body>${sdt(`<w:alias w:val="X"/><w:text/>`, p('Hi'))}</w:body></w:document>`,
      { name: '/word/document.xml', contentType: 'app/xml' }
    );
    if (!part.ok) throw new Error(part.reason);
    const layout = layoutSemanticDocument(part.part, 1, {
      measurer: createFixedMeasurer(6, 14),
    });
    const container = document.createElement('div');
    const controlId = layout.contentControls![0]!.id;
    paintSemanticLayout(container, layout, {
      scale: 1,
      ariaHidden: false,
      contentControlChrome: { showAll: true, activeIds: new Set([controlId]) },
    });
    const marker = container.querySelector('[data-docx-content-control]');
    expect(marker?.getAttribute('contenteditable')).toBe('false');
    expect(marker?.hasAttribute('data-docx-marker')).toBe(true);
    expect(
      container.querySelector('.docx-content-control-boundary')?.hasAttribute('data-docx-marker')
    ).toBe(true);
  });

  test('form-fill Tab navigates by tabIndex then document order, skipping locked', () => {
    const body =
      sdt(`<w:tag w:val="c"/><w:tabIndex w:val="2"/><w:text/>`, p('third')) +
      sdt(`<w:tag w:val="a"/><w:tabIndex w:val="1"/><w:text/>`, p('first')) +
      sdt(`<w:tag w:val="locked"/><w:lock w:val="contentLocked"/><w:text/>`, p('skip')) +
      sdt(`<w:tag w:val="b"/><w:text/>`, p('second'));
    const { surface } = mount(body);
    surface.contentControls.setFormFill(true);
    expect(surface.state().contentControls.formFill).toBe(true);

    const controls = surface.layout().contentControls ?? [];
    const byTag = Object.fromEntries(controls.map((c) => [c.tag, c]));
    expect(byTag.locked?.effectiveLock).toBe('contentLocked');

    // Start at tabIndex=1 ("a"), then walk next — locked must never appear.
    const aPara = surface.session.paragraphIds()[1]!;
    surface.setSelection({
      anchor: { paragraphId: aPara, offset: 0 },
      head: { paragraphId: aPara, offset: 0 },
    });
    expect(surface.contentControls.atCaret()?.tag).toBe('a');

    const visited: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      const tag = surface.contentControls.atCaret()?.tag;
      if (tag) visited.push(tag);
      expect(surface.contentControls.navigate('next')).toBe(true);
    }
    expect(visited.includes('locked')).toBe(false);
    // tabIndex order: a (1) then c (2); b has no tabIndex and follows document order among
    // the remaining editable controls after indexed ones.
    expect(visited.filter((t, i) => visited.indexOf(t) === i)).toEqual(
      expect.arrayContaining(['a', 'c', 'b'])
    );
    const unique = visited.filter((t, i) => visited.indexOf(t) === i);
    expect(unique.indexOf('a')).toBeLessThan(unique.indexOf('c'));
  });

  test('ordinary Tab does not capture when form-fill is off', () => {
    const { surface } = mount(sdt(`<w:text/>`, p('hello')));
    putCaret(surface, 0);
    expect(surface.contentControls.formFill()).toBe(false);
    expect(surface.contentControls.navigate('next')).toBe(true); // API still works
    // Keymap path: without form-fill, insertTab would run — verify mode gate.
    surface.contentControls.setFormFill(false);
    expect(surface.state().contentControls.formFill).toBe(false);
  });

  test('setValue and remove honour lock and bound', () => {
    const locked = sdt(`<w:lock w:val="sdtContentLocked"/><w:text/>`, p('L'));
    const bound = sdt(
      `<w:dataBinding w:prefixMappings="" w:xpath="/x" w:storeItemID="{00000000-0000-0000-0000-000000000000}"/><w:text/>`,
      p('B')
    );
    const open = sdt(`<w:text/>`, p('O'));
    const { surface } = mount(locked + bound + open);
    const controls = surface.layout().contentControls ?? [];
    expect(controls.length).toBe(3);
    const lockedId = controls.find((c) => c.effectiveLock === 'sdtContentLocked')!.id;
    const boundId = controls.find((c) => c.bound)!.id;
    const openId = controls.find((c) => !c.bound && c.effectiveLock === 'unlocked')!.id;

    expect(surface.contentControls.disabledReason(lockedId, 'edit')).toBe('locked');
    expect(surface.contentControls.disabledReason(lockedId, 'remove')).toBe('locked');
    expect(surface.contentControls.disabledReason(boundId, 'edit')).toBe('bound');
    expect(surface.contentControls.setValue(lockedId, 'x')).toBe(false);
    expect(surface.contentControls.setValue(boundId, 'x')).toBe(false);
    expect(surface.contentControls.remove(lockedId)).toBe(false);

    expect(surface.contentControls.disabledReason(openId, 'remove')).toBeNull();
    expect(surface.contentControls.remove(openId)).toBe(true);
    expect(surface.layout().contentControls?.some((c) => c.id === openId)).toBe(false);
    expect(surface.session.bodyText()).toContain('O');
  });

  test('viewing mode refuses every control write and disables the painted widget', () => {
    // This lane called `session.applyTreeOps` directly rather than the gated session, so a
    // checkbox on a document open for viewing still toggled and still committed. The widget
    // is engine-painted, so the mode has to reach the DOM too — the pointer lane skips a
    // widget carrying `data-disabled-reason`, which is what stops the click.
    const body =
      `<w:p>${sdt(
        `<w14:checkbox><w14:checked w14:val="0"/>` +
          `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
          `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/></w14:checkbox>`,
        `<w:r><w:t>x</w:t></w:r>`
      )}</w:p>` + sdt(`<w:text/>`, p('O'));
    const { surface, container } = mount(body);
    const controls = surface.layout().contentControls ?? [];
    const checkboxId = controls.find((c) => c.controlType === 'checkbox')!.id;
    const openId = controls.find((c) => c.controlType !== 'checkbox')!.id;
    const revision = surface.session.packageRevision();

    surface.setEditingMode('view');

    expect(surface.contentControls.disabledReason(checkboxId, 'edit')).toBe(
      'the document is open for viewing'
    );
    expect(surface.contentControls.disabledReason(openId, 'remove')).toBe(
      'the document is open for viewing'
    );
    expect(surface.contentControls.setValue(checkboxId, '1')).toBe(false);
    expect(surface.contentControls.remove(openId)).toBe(false);
    expect(surface.session.packageRevision()).toBe(revision);

    const widget = container.querySelector<HTMLButtonElement>('[data-docx-cc-widget]');
    expect(widget).not.toBeNull();
    expect(widget!.disabled).toBe(true);
    expect(widget!.dataset.disabledReason).toBe('readOnly');
    expect(
      container.querySelector('.docx-content-control-chrome')?.hasAttribute('data-read-only')
    ).toBe(true);

    // Reversible: the reader chose viewing and can choose again.
    surface.setEditingMode('edit');
    expect(surface.contentControls.disabledReason(openId, 'remove')).toBeNull();
    const back = container.querySelector<HTMLButtonElement>('[data-docx-cc-widget]');
    expect(back!.disabled).toBe(false);
    expect(surface.contentControls.setValue(checkboxId, '1')).toBe(true);
  });

  test('viewing mode takes the pages layer out of contenteditable', () => {
    // `setEditable` and `setEditingMode` were two independent writes of one state, kept in
    // step only by the facade — so a host driving the surface itself kept a writable pages
    // layer, a caret and an IME on a document that refuses every write.
    const { surface, container } = mount(sdt(`<w:text/>`, p('O')));
    const pages = container.querySelector<HTMLElement>('.docx-pages')!;
    expect(pages.contentEditable).toBe('true');

    surface.setEditingMode('view');
    expect(pages.contentEditable).toBe('false');
    expect(pages.getAttribute('aria-readonly')).toBe('true');

    surface.setEditingMode('edit');
    expect(pages.contentEditable).toBe('true');
    expect(pages.getAttribute('aria-readonly')).toBe('false');

    // The host's own wish still outranks a non-viewing mode.
    surface.setEditable(false);
    expect(pages.contentEditable).toBe('false');
    surface.setEditingMode('suggest');
    expect(pages.contentEditable).toBe('false');
  });

  test('foreign-namespace sdt is opaque to surface content-control ops', () => {
    const { surface } = mount(
      `<x:sdt xmlns:x="http://example.com/x"><x:sdtPr/><x:sdtContent>${p('foreign')}</x:sdtContent></x:sdt>` +
        sdt(`<w:alias w:val="Real"/><w:text/>`, p('real'))
    );
    const part = surface.session.part();
    const foreignIds: string[] = [];
    const walk = (node: {
      kind: string;
      id?: string;
      localName?: string;
      namespaceUri?: string;
      children?: readonly unknown[];
    }): void => {
      if (node.kind === 'generic' && node.localName === 'sdt' && node.namespaceUri !== W) {
        if (typeof node.id === 'string') foreignIds.push(node.id);
      }
      if (Array.isArray(node.children)) {
        for (const child of node.children) walk(child as typeof node);
      }
    };
    walk(part.root as never);
    expect(foreignIds.length).toBeGreaterThan(0);
    for (const id of foreignIds) {
      expect(surface.contentControls.disabledReason(id, 'edit')).toBe('notFound');
      expect(surface.contentControls.remove(id)).toBe(false);
      expect(surface.contentControls.setValue(id, 'x')).toBe(false);
    }
    // Real WML control remains addressable.
    const real = surface.layout().contentControls?.find((c) => c.alias === 'Real');
    expect(real).toBeTruthy();
    expect(surface.contentControls.disabledReason(real!.id, 'edit')).toBeNull();
  });

  test('checkbox widget commit goes through setContentControlValue', () => {
    const body =
      `<w:p>${sdt(
        `<w14:checkbox><w14:checked w14:val="0"/>` +
          `<w14:checkedState w14:val="2612" w14:font="MS Gothic"/>` +
          `<w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>` +
          `</w14:checkbox>`,
        `<w:r><w:sym w:font="MS Gothic" w:char="2610"/></w:r>`
      )}` + `<w:r><w:t> Task pending</w:t></w:r></w:p>`;
    const { surface, container } = mount(body);
    const control = surface.layout().contentControls?.[0];
    expect(control?.controlType).toBe('checkbox');
    surface.contentControls.setShowAll(true);
    const before = container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]');
    expect(before?.getAttribute('data-checked')).toBe('false');
    expect(before?.getAttribute('aria-checked')).toBe('false');

    before!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );

    const after = container.querySelector<HTMLElement>('[data-docx-cc-widget="checkbox"]');
    expect(after?.getAttribute('data-checked')).toBe('true');
    expect(after?.getAttribute('aria-checked')).toBe('true');
  });
});
