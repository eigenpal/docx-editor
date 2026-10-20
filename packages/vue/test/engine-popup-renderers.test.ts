import './dom-setup.ts';
import { afterEach, expect, test } from 'bun:test';
import { createApp, h, nextTick, shallowRef, defineComponent, watch } from 'vue';
import { strToU8, zipSync } from 'fflate';
import type {
  ContentControlWidgetSession,
  InvalidTextFormFieldSession,
} from '@docx-editor.dev/core/editor';
import { DocxEditorContentControlWidget } from '../src/editor/DocxEditorContentControlWidget';
import { DocxEditorInvalidTextFormFieldDialog } from '../src/editor/DocxEditorInvalidTextFormFieldDialog';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});
function widget(value: string, kind: ContentControlWidgetSession['kind'] = 'date') {
  const abort = new AbortController();
  const writes: string[] = [];
  const session: ContentControlWidgetSession = {
    controlId: 'sdt:1',
    kind,
    items: [{ displayText: 'First', value: 'first' }],
    value,
    locale: 'en-US',
    anchor: null,
    signal: abort.signal,
    canApply: () => !abort.signal.aborted,
    apply: (next) => {
      writes.push(next);
      abort.abort();
      return true;
    },
    cancel: () => abort.abort(),
  };
  return { session, abort, writes };
}
test('widget normalizes authored dates and resets on a new session', async () => {
  const first = widget('2026-09-08T00:00:00Z');
  const current = shallowRef(first.session);
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () => h(DocxEditorContentControlWidget, { session: current.value }),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await nextTick();
  // The picker opens on the authored month with the authored day marked; a press on that
  // day writes the ISO date and closes the pop-up.
  expect(container.querySelector('.docx-content-control-calendar-title')?.textContent).toBe(
    'September 2026'
  );
  const selected = container.querySelector<HTMLButtonElement>('[data-selected]')!;
  expect(selected.dataset.iso).toBe('2026-09-08');
  expect(container.querySelector('input[type="date"]')).toBeNull();
  selected.click();
  await nextTick();
  expect(first.writes).toEqual(['2026-09-08']);
  expect(container.querySelector('[role="dialog"]')).toBeNull();
  current.value = widget('2026-10-01').session;
  await nextTick();
  expect(container.querySelector('.docx-content-control-calendar-title')?.textContent).toBe(
    'October 2026'
  );
  expect(container.querySelector<HTMLElement>('[data-selected]')?.dataset.iso).toBe('2026-10-01');
});

test('invalid-field acknowledgement closes the native modal synchronously before core restoration', async () => {
  const abort = new AbortController();
  let closedDuringAcknowledge = false;
  const session: InvalidTextFormFieldSession = {
    type: 'number',
    signal: abort.signal,
    cancel: () => abort.abort(),
    acknowledge: () => {
      abort.abort();
      closedDuringAcknowledge = !(container.querySelector('dialog') as HTMLDialogElement)?.open;
    },
  };
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({ render: () => h(DocxEditorInvalidTextFormFieldDialog, { session }) });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await nextTick();
  expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
  (container.querySelector('button') as HTMLButtonElement).click();
  expect(closedDuringAcknowledge).toBe(true);
  await nextTick();
  expect(container.querySelector('dialog')).toBeNull();
});

for (const mode of ['native', 'custom', 'manual'] as const)
  test(`value widget ownership: ${mode}`, async () => {
    const { DocxEditorRoot } = await import('../src/editor/DocxEditorRoot');
    const { DocxEditorViewport } = await import('../src/editor/DocxEditorViewport');
    const { DocxEditorContent } = await import('../src/editor/DocxEditorContent');
    const { useDocxEditor } = await import('../src/editor/context');
    const { docx, flush } = await import('./helpers/fixtures');
    const source = docx(
      '<w:sdt><w:sdtPr><w:dropDownList><w:listItem w:displayText="One" w:value="1"/><w:listItem w:displayText="Two" w:value="2"/></w:dropDownList></w:sdtPr><w:sdtContent><w:p><w:r><w:t>One</w:t></w:r></w:p></w:sdtContent></w:sdt>'
    );
    let manual: ContentControlWidgetSession | undefined;
    let editor: import('@docx-editor.dev/core/editor').DocxEditorInstance | undefined;
    const Manual = defineComponent({
      setup() {
        // Vue composables run in setup; this is not a React hook.
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const owner = useDocxEditor();
        watch(
          owner,
          (instance, _old, onCleanup) => {
            if (instance)
              onCleanup(
                instance.setContentControlWidgetChrome({
                  onRequest: (session) => {
                    manual = session;
                  },
                })
              );
          },
          { immediate: true }
        );
        return () => null;
      },
    });
    const container = document.createElement('div');
    document.body.append(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: source,
            onReady: (value) => {
              editor = value as typeof editor;
            },
            popups: {
              contentControlWidget:
                mode === 'native'
                  ? undefined
                  : mode === 'manual'
                    ? false
                    : (props) => h(DocxEditorContentControlWidget, props),
            },
          },
          {
            default: () =>
              h(DocxEditorViewport, null, {
                default: () => [h(DocxEditorContent), mode === 'manual' ? h(Manual) : null],
              }),
          }
        ),
    });
    app.mount(container);
    cleanups.push(() => {
      app.unmount();
      container.remove();
    });
    await flush();
    const opener = document.createElement('button');
    opener.textContent = 'Opener';
    container.append(opener);
    opener.focus();
    const trigger = container.querySelector('[data-docx-cc-widget="dropdown"]');
    expect(trigger).not.toBeNull();
    trigger!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
    await flush();
    expect(container.querySelectorAll('.docx-content-control-menu').length).toBe(
      mode === 'native' ? 1 : 0
    );
    expect(container.querySelectorAll('[data-docx-popup="contentControlWidget"]').length).toBe(
      mode === 'custom' ? 1 : 0
    );
    if (mode === 'manual') {
      expect(manual).toBeDefined();
      expect(manual!.signal.aborted).toBe(false);
      expect(manual!.apply('2')).toBe(true);
      await flush();
      expect(editor!.surface!.session.bodyText()).toContain('Two');
    }
    if (mode === 'custom') {
      // Escape closes without a write and hands focus back to the opener.
      const popup = container.querySelector<HTMLElement>(
        '[data-docx-popup="contentControlWidget"]'
      )!;
      popup.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })
      );
      await flush();
      expect(container.querySelector('[data-docx-popup="contentControlWidget"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
      container.querySelector('[data-docx-cc-widget="dropdown"]')!.dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerId: 1,
          pointerType: 'mouse',
        })
      );
      await flush();
      // The packaged dropdown is the same list the engine paints: one option per entry, the
      // current value marked, and a press commits at once — no Apply step, as in Word.
      // Scoped to the pop-up: the painted widget button itself carries role="listbox".
      const reopened = container.querySelector<HTMLElement>(
        '[data-docx-popup="contentControlWidget"]'
      )!;
      const options = [...reopened.querySelectorAll<HTMLButtonElement>('[role="option"]')];
      expect(options.map((option) => option.textContent)).toEqual(['One', 'Two']);
      expect(options[0]!.getAttribute('aria-selected')).toBe('true');
      expect(reopened.querySelector('[role="listbox"]')!.contains(document.activeElement)).toBe(
        true
      );
      options[1]!.click();
      await flush();
      expect(editor!.surface!.session.bodyText()).toContain('Two');
      expect(container.querySelector('[data-docx-popup="contentControlWidget"]')).toBeNull();
      expect(document.activeElement).toBe(opener);
    }
  });

test('widget cleanup preserves focus moved to an outside control', async () => {
  const { session, abort } = widget('2026-09-08');
  const container = document.createElement('div');
  const outside = document.createElement('button');
  document.body.append(container, outside);
  outside.focus();
  const app = createApp({ render: () => h(DocxEditorContentControlWidget, { session }) });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
    outside.remove();
  });
  await nextTick();
  const other = document.createElement('button');
  document.body.append(other);
  cleanups.push(() => other.remove());
  other.focus();
  abort.abort();
  await nextTick();
  expect(document.activeElement).toBe(other);
});

for (const configured of [false, true])
  test(`checkbox presses reach a renderer only through contentControlCheckbox (${configured})`, async () => {
    const { DocxEditorRoot } = await import('../src/editor/DocxEditorRoot');
    const { DocxEditorViewport } = await import('../src/editor/DocxEditorViewport');
    const { DocxEditorContent } = await import('../src/editor/DocxEditorContent');
    const { docx, flush } = await import('./helpers/fixtures');
    const source = docx(
      '<w:p><w:r><w:t xml:space="preserve">Done: </w:t></w:r><w:sdt><w:sdtPr>' +
        '<w14:checkbox xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w14:checked w14:val="0"/>' +
        '<w14:checkedState w14:val="2612" w14:font="MS Gothic"/><w14:uncheckedState w14:val="2610" w14:font="MS Gothic"/>' +
        '</w14:checkbox></w:sdtPr><w:sdtContent><w:r><w:t>☐</w:t></w:r></w:sdtContent></w:sdt><w:r><w:t xml:space="preserve"> yes</w:t></w:r></w:p>'
    );
    const seen: ContentControlWidgetSession['kind'][] = [];
    const recorder = (props: { session: ContentControlWidgetSession }) => {
      seen.push(props.session.kind);
      return h(DocxEditorContentControlWidget, props);
    };
    const container = document.createElement('div');
    document.body.append(container);
    const app = createApp({
      render: () =>
        h(
          DocxEditorRoot,
          {
            document: source,
            popups: {
              contentControlWidget: recorder,
              ...(configured ? { contentControlCheckbox: recorder } : {}),
            },
          },
          { default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }) }
        ),
    });
    app.mount(container);
    cleanups.push(() => {
      app.unmount();
      container.remove();
    });
    await flush();
    const widget = container.querySelector('[data-docx-cc-widget="checkbox"]');
    expect(widget).not.toBeNull();
    widget!.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerId: 1,
        pointerType: 'mouse',
      })
    );
    await flush();
    // Either way the box flips: the engine toggles it when no renderer takes the press, and
    // the packaged renderer applies the toggle at once when one does.
    expect(
      container.querySelector('[data-docx-cc-widget="checkbox"]')?.getAttribute('data-checked')
    ).toBe('true');
    // A pop-up renderer written for dropdowns never sees the checkbox session.
    expect(seen).toEqual(configured ? ['checkbox'] : []);
  });

const PNG_1X1 = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='
  ),
  (c) => c.charCodeAt(0)
);
const NS = {
  w: 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
  wp: 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing',
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  pic: 'http://schemas.openxmlformats.org/drawingml/2006/picture',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
  rel: 'http://schemas.openxmlformats.org/package/2006/relationships',
};
const OD_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument';
const IMG_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image';
const GLOSSARY_REL =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/glossaryDocument';

/** A document whose main part carries an image relationship and, optionally, a glossary. */
function richDocx(body: string, glossary?: string): Uint8Array {
  return zipSync({
    '[Content_Types].xml': strToU8(
      `<Types xmlns="${NS.ct}">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="png" ContentType="image/png"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        (glossary
          ? '<Override PartName="/word/glossary/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.glossary+xml"/>'
          : '') +
        '</Types>'
    ),
    '_rels/.rels': strToU8(
      `<Relationships xmlns="${NS.rel}"><Relationship Id="rId1" Type="${OD_REL}" Target="word/document.xml"/></Relationships>`
    ),
    'word/_rels/document.xml.rels': strToU8(
      `<Relationships xmlns="${NS.rel}"><Relationship Id="rIdImg" Type="${IMG_REL}" Target="media/image1.png"/>` +
        (glossary
          ? `<Relationship Id="rIdGl" Type="${GLOSSARY_REL}" Target="glossary/document.xml"/>`
          : '') +
        '</Relationships>'
    ),
    'word/media/image1.png': PNG_1X1,
    ...(glossary ? { 'word/glossary/document.xml': strToU8(glossary) } : {}),
    'word/document.xml': strToU8(
      `<w:document xmlns:w="${NS.w}" xmlns:wp="${NS.wp}" xmlns:a="${NS.a}" xmlns:pic="${NS.pic}" xmlns:r="${NS.r}"><w:body>${body}</w:body></w:document>`
    ),
  });
}

const PICTURE_PRESS = richDocx(
  '<w:p><w:r><w:t xml:space="preserve">Photo: </w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="Photo"/><w:picture/></w:sdtPr>' +
    '<w:sdtContent><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
    '<wp:extent cx="457200" cy="457200"/><wp:docPr id="3" name="pic"/>' +
    `<a:graphic><a:graphicData uri="${NS.pic}"><pic:pic>` +
    '<pic:nvPicPr><pic:cNvPr id="3" name="pic"/><pic:cNvPicPr/></pic:nvPicPr>' +
    '<pic:blipFill><a:blip r:embed="rIdImg"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
    '<pic:spPr><a:xfrm><a:ext cx="457200" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></pic:spPr>' +
    '</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:sdtContent></w:sdt></w:p>'
);

const GALLERY_PRESS = richDocx(
  '<w:p><w:r><w:t xml:space="preserve">Pick: </w:t></w:r><w:sdt><w:sdtPr><w:alias w:val="Block"/><w:showingPlcHdr/>' +
    '<w:docPartList><w:docPartGallery w:val="Quick Parts"/></w:docPartList></w:sdtPr>' +
    '<w:sdtContent><w:r><w:t>Choose a building block.</w:t></w:r></w:sdtContent></w:sdt></w:p>',
  `<w:glossaryDocument xmlns:w="${NS.w}"><w:docParts>` +
    '<w:docPart><w:docPartPr><w:name w:val="Sign-off"/><w:category><w:name w:val="General"/><w:gallery w:val="docParts"/></w:category></w:docPartPr>' +
    '<w:docPartBody><w:p><w:r><w:t>Approved by the board</w:t></w:r></w:p></w:docPartBody></w:docPart>' +
    '<w:docPart><w:docPartPr><w:name w:val="Address"/><w:category><w:name w:val="General"/><w:gallery w:val="docParts"/></w:category></w:docPartPr>' +
    '<w:docPartBody><w:p><w:r><w:t>1 Main St</w:t></w:r></w:p></w:docPartBody></w:docPart>' +
    '</w:docParts></w:glossaryDocument>'
);

async function mountRoot(
  source: Uint8Array,
  popups: Record<string, unknown>,
  onReady?: (instance: unknown) => void
): Promise<HTMLElement> {
  const { DocxEditorRoot } = await import('../src/editor/DocxEditorRoot');
  const { DocxEditorViewport } = await import('../src/editor/DocxEditorViewport');
  const { DocxEditorContent } = await import('../src/editor/DocxEditorContent');
  const { flush } = await import('./helpers/fixtures');
  const container = document.createElement('div');
  document.body.append(container);
  const app = createApp({
    render: () =>
      h(
        DocxEditorRoot,
        { document: source, popups, ...(onReady ? { onReady } : {}) },
        { default: () => h(DocxEditorViewport, null, { default: () => h(DocxEditorContent) }) }
      ),
  });
  app.mount(container);
  cleanups.push(() => {
    app.unmount();
    container.remove();
  });
  await flush();
  return container;
}

function pressWidget(container: HTMLElement, kind: string): void {
  const widget = container.querySelector(`[data-docx-cc-widget="${kind}"]`);
  expect(widget).not.toBeNull();
  widget!.dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerId: 1,
      pointerType: 'mouse',
    })
  );
}

for (const configured of [false, true])
  test(`picture presses reach a renderer only through contentControlPicture (${configured})`, async () => {
    const { flush } = await import('./helpers/fixtures');
    const seen: ContentControlWidgetSession['kind'][] = [];
    const recorder = (props: { session: ContentControlWidgetSession }) => {
      seen.push(props.session.kind);
      return h(DocxEditorContentControlWidget, props);
    };
    const container = await mountRoot(PICTURE_PRESS, {
      contentControlWidget: recorder,
      ...(configured ? { contentControlPicture: recorder } : {}),
    });
    pressWidget(container, 'picture');
    await flush();
    // The packaged renderer is a file input in a panel that takes no room; without the
    // entry the engine arms its own picker on the pages layer, and the pop-up renderer
    // written for lists never sees the press.
    const popup = container.querySelector<HTMLElement>('[data-docx-popup="contentControlWidget"]');
    expect(popup !== null).toBe(configured);
    expect(popup?.querySelector('[data-docx-part=picture]') !== null && popup !== null).toBe(
      configured
    );
    expect(container.querySelector('input[type="file"][data-docx-part="picture"]') !== null).toBe(
      configured
    );
    expect(container.querySelector('.docx-content-control-picture-picker') !== null).toBe(
      !configured
    );
    expect(seen).toEqual(configured ? ['picture'] : []);
  });

test('a gallery press renders the packaged list of glossary blocks, and a pick lands one', async () => {
  const { flush } = await import('./helpers/fixtures');
  let editor: import('@docx-editor.dev/core/editor').DocxEditorInstance | undefined;
  const container = await mountRoot(
    GALLERY_PRESS,
    {
      contentControlWidget: (props: { session: ContentControlWidgetSession }) =>
        h(DocxEditorContentControlWidget, props),
    },
    (instance) => {
      editor = instance as typeof editor;
    }
  );
  pressWidget(container, 'buildingBlockGallery');
  await flush();
  const popup = container.querySelector<HTMLElement>('[data-docx-popup="contentControlWidget"]')!;
  expect(popup.getAttribute('data-kind')).toBe('buildingBlockGallery');
  const options = [...popup.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options.map((option) => option.textContent)).toEqual(['Address', 'Sign-off']);
  options[1]!.click();
  await flush();
  expect(editor!.surface!.session.bodyText()).toBe('Pick: Approved by the board');
  expect(container.querySelector('[data-docx-popup="contentControlWidget"]')).toBeNull();
});
