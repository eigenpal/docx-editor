import {
  computed,
  defineComponent,
  Fragment,
  h,
  provide,
  shallowRef,
  type Component,
  type PropType,
  type VNode,
} from 'vue';
import type { DocxEditorChildren } from '../../docx-editor-children';
import type { EditorSnapshot } from '@docx-editor.dev/core/contracts/editor';
import {
  chromeSlotId,
  formattingBarChromeGroups,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { docxSlotOf, unwrapFragment } from '../merge-arrangement';
import { flattenChildren } from '../../lib/flattenChildren';
import { useEditorState } from '../useEditorState';
import { useScopeClassName } from '../scope-context';
import { ToolbarContext, useToolbarLabel, type ToolbarTranslate } from './toolbar-context';
import { ToolbarButton, chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import {
  ToolbarOverflow,
  ToolbarOverflowControl,
  ToolbarOverflowItem,
  type ToolbarOverflowSection,
} from './ToolbarOverflow';
import {
  arrangeToolbarGroups,
  collapseOrder,
  TOOLBAR_COLLAPSE_ORDER,
  TOOLBAR_PINNED_GROUPS,
} from '@docx-editor.dev/core/editor';
import { readToolbarChildren, vnodeFlag, type ToolbarChildren } from './toolbar-children';
import {
  hostGroupText,
  ToolbarHostGroup,
  ToolbarPanelPlacement,
  ToolbarSlot,
  type DocxEditorToolbarGroupProps,
} from './ToolbarGroup';
import { ToolbarAddComment } from './AddComment';
import {
  warnBuiltInGroupSetting,
  warnReservedGroupId,
  warnSlotOutsideArrangement,
  warnUnknownGroupAnchor,
} from './toolbar-warnings';
import { FIXED_ATTRIBUTE, GROUP_ATTRIBUTE, useToolbarOverflow } from './useToolbarOverflow';
import {
  ToolbarImageInsert,
  ToolbarImageWrap,
  ToolbarImageAltText,
  type ImageAltTextPartComponent,
  type ImageWrapPartComponent,
} from '../images';
import { ToolbarImageProperties } from '../images/ImageProperties';
import {
  ToolbarAlignCenter,
  ToolbarAlignJustify,
  ToolbarAlignLeft,
  ToolbarAlignRight,
  ToolbarBold,
  ToolbarBulletList,
  ToolbarClearFormatting,
  ToolbarComments,
  ToolbarIndent,
  ToolbarItalic,
  ToolbarLeftToRight,
  ToolbarLink,
  ToolbarNumberedList,
  ToolbarOutdent,
  ToolbarRedo,
  ToolbarRightToLeft,
  ToolbarSave,
  ToolbarSeparator,
  ToolbarStrike,
  ToolbarSubscript,
  ToolbarSuperscript,
  ToolbarTableInsert,
  ToolbarUnderline,
  ToolbarUndo,
  type ToolbarPartComponent,
  type ToolbarSlotPartComponent,
} from './parts';
import { ToolbarFontSize, ToolbarZoom } from './steppers';
import { ToolbarLineSpacing } from './LineSpacing';
import { ToolbarFontColor, ToolbarHighlight, type ToolbarColorSplitComponent } from './ColorSplit';
import { ToolbarAlignment, type ToolbarAlignmentComponent } from './Alignment';
import { ToolbarAction } from './ToolbarAction';
import { FontFamily, useFontFamily } from './FontFamily';
import { ParagraphStyle, useParagraphStyle } from './ParagraphStyle';
import {
  CONTENT_CONTROL_SHAPED_PARTS,
  ToolbarContentControlFormFill,
  ToolbarContentControlInspector,
  ToolbarContentControlRemove,
  ToolbarContentControlShowAll,
} from './ContentControlParts';
import {
  TableChromeGroup,
  ToolbarTableBorderColor,
  ToolbarTableBorderStyle,
  ToolbarTableBorderTarget,
  ToolbarTableBorderWidth,
  ToolbarTableCellFill,
  type TableBorderColorNamespace,
  type TableBorderStyleNamespace,
  type TableBorderTargetNamespace,
  type TableBorderWidthNamespace,
  type TableCellFillNamespace,
} from './TableControls';
import { ParagraphDialogHost } from '../paragraph-dialog-host';
import { TableChromeProvider } from './useTableChrome';
import { ToolbarEditingMode } from './EditingMode';
import { ToolbarReviewers } from './Reviewers';

const TABLE_CHROME_SLOTS: readonly ChromeSlotId[] = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
];

const TABLE_CONTEXTUAL_GROUP_ID = 'contextual-table';

type ArrangementKey = ChromeSlotId | 'alignment';

interface DefaultEntry {
  readonly slot: ArrangementKey;
  readonly Part: Component;
}

interface DefaultGroup {
  readonly id: string;
  readonly labelKey: string;
  readonly entries: readonly DefaultEntry[];
}

type PartLike = Component;

const SHAPED_PARTS: Partial<Record<ChromeSlotId, PartLike>> = {
  'zoom.level': ToolbarZoom,
  'styles.style': ParagraphStyle,
  'font.family': FontFamily,
  'font.size': ToolbarFontSize,
  'text.color': ToolbarFontColor,
  'text.highlight': ToolbarHighlight,
  'text.link': ToolbarLink,
  'list.lineSpacing': ToolbarLineSpacing,
  'review.editingMode': ToolbarEditingMode,
  'review.authors': ToolbarReviewers,
  'file.save': ToolbarSave,
  ...CONTENT_CONTROL_SHAPED_PARTS,
  'table.borderTarget': ToolbarTableBorderTarget,
  'table.borderColor': ToolbarTableBorderColor,
  'table.borderStyle': ToolbarTableBorderStyle,
  'table.borderWidth': ToolbarTableBorderWidth,
  'table.cellFill': ToolbarTableCellFill,
  'image.insert': ToolbarImageInsert,
  'image.wrap': ToolbarImageWrap,
  'image.altText': ToolbarImageAltText,
};

const TABLE_CONTEXTUAL_GROUP: DefaultGroup = {
  id: TABLE_CONTEXTUAL_GROUP_ID,
  labelKey: 'formattingBar.groups.table',
  entries: TABLE_CHROME_SLOTS.map((slot) => ({ slot, Part: SHAPED_PARTS[slot]! })),
};

const iconPartCache = new Map<ChromeSlotId, PartLike>();
function iconPart(slot: ChromeSlotId): PartLike {
  let part = iconPartCache.get(slot);
  if (!part) {
    part = defineComponent({
      name: `ToolbarIconPart_${slot.replace(/\./g, '_')}`,
      props: { hidden: { type: Boolean, default: undefined } },
      setup(props) {
        return () => h(ToolbarButton, { slotId: slot, hidden: props.hidden });
      },
    });
    iconPartCache.set(slot, part);
  }
  return part;
}

function buildDefaultGroups(image: EditorSnapshot['image']): readonly DefaultGroup[] {
  return formattingBarChromeGroups(image).map((group) => {
    if (group.id === 'alignment') {
      return {
        id: group.id,
        labelKey: group.labelKey,
        entries: [{ slot: 'alignment' as ArrangementKey, Part: ToolbarAlignment }],
      };
    }
    return {
      id: group.id,
      labelKey: group.labelKey,
      entries: group.controls.map((control) => {
        const slot = chromeSlotId(group, control);
        return { slot: slot as ArrangementKey, Part: SHAPED_PARTS[slot] ?? iconPart(slot) };
      }),
    };
  });
}

const selectToolbarImage = (snapshot: EditorSnapshot) => snapshot.image;
const selectToolbarDisabled = (snapshot: EditorSnapshot) =>
  snapshot.isLoading || snapshot.isOpening === true;
const selectTableChromeVisible = (snapshot: EditorSnapshot) => snapshot.table !== null;

function isValueSlot(slot: ArrangementKey): boolean {
  return slot === 'alignment' || slot in SHAPED_PARTS;
}

function slotOfChild(child: VNode): ArrangementKey | null {
  const unwrapped = unwrapFragment(child, slotOfChild);
  if (unwrapped !== null) return unwrapped as ArrangementKey;
  const slot = docxSlotOf(child);
  if (slot) return slot as ArrangementKey;
  const type = child.type;
  if (typeof type === 'object' && type !== null && 'docxToolbarSlot' in type) {
    // A template passes the prop as `slot-id`, a render function as `slotId`.
    const slotId = child.props?.slotId ?? child.props?.['slot-id'];
    return typeof slotId === 'string' ? (slotId as ArrangementKey) : null;
  }
  if (typeof type === 'object' && type !== null && 'docxToolbarPart' in type) {
    // A template passes the prop as `slot-id`, a render function as `slotId`.
    const slotProp = child.props?.slotId ?? child.props?.['slot-id'] ?? child.props?.slot;
    if (typeof slotProp === 'string') return slotProp as ArrangementKey;
  }
  return null;
}

function isHiddenOverride(vnode: VNode | undefined): boolean {
  if (!vnode) return false;
  // A template's bare `hidden` attribute arrives as an empty string.
  return vnodeFlag(vnode.props?.hidden);
}

function walkForTableChromeParts(nodes: VNode[]): boolean {
  for (const node of nodes) {
    const slot = slotOfChild(node);
    if (slot != null && (TABLE_CHROME_SLOTS as readonly string[]).includes(slot)) return true;
    if (node.children) {
      const inner = flattenChildren(node.children);
      if (walkForTableChromeParts(inner)) return true;
    }
  }
  return false;
}

/** @public */
export interface DocxEditorToolbarProps {
  className?: string;
  t?: ToolbarTranslate;
  onSave?: () => void;
  preset?: boolean;
  overflow?: boolean;
  children?: DocxEditorChildren;
}

/** @public */
export interface DocxEditorToolbarNamespace {
  (props: DocxEditorToolbarProps): VNode;
  readonly Button: typeof ToolbarButton;
  readonly Action: typeof ToolbarAction;
  readonly Separator: typeof ToolbarSeparator;
  /**
   * A group of the preset bar: host content that is measured and collapses into the "⋯"
   * panel, or, with a built-in id, controls added to that group or the group hidden.
   */
  readonly Group: typeof ToolbarHostGroup;
  /** Replaces one built-in slot with arbitrary content, in the slot's place. */
  readonly Slot: typeof ToolbarSlot;
  /** Opens a comment draft on the selection in the review rail. */
  readonly AddComment: typeof ToolbarAddComment;
  readonly Undo: ToolbarPartComponent;
  readonly Redo: ToolbarPartComponent;
  readonly Bold: ToolbarPartComponent;
  readonly Italic: ToolbarPartComponent;
  readonly Underline: ToolbarPartComponent;
  readonly Strike: ToolbarPartComponent;
  readonly Link: ToolbarPartComponent;
  readonly ClearFormatting: ToolbarPartComponent;
  readonly Superscript: ToolbarPartComponent;
  readonly Subscript: ToolbarPartComponent;
  readonly Alignment: ToolbarAlignmentComponent;
  readonly AlignLeft: ToolbarPartComponent;
  readonly AlignCenter: ToolbarPartComponent;
  readonly AlignRight: ToolbarPartComponent;
  readonly AlignJustify: ToolbarPartComponent;
  readonly LeftToRight: ToolbarPartComponent;
  readonly RightToLeft: ToolbarPartComponent;
  readonly LineSpacing: ToolbarSlotPartComponent;
  readonly BulletList: ToolbarPartComponent;
  readonly NumberedList: ToolbarPartComponent;
  readonly Outdent: ToolbarPartComponent;
  readonly Indent: ToolbarPartComponent;
  readonly ImageInsert: ToolbarPartComponent;
  readonly ImageWrap: ImageWrapPartComponent;
  readonly ImageAltText: ImageAltTextPartComponent;
  readonly ImageProperties: ToolbarPartComponent;
  readonly TableInsert: ToolbarPartComponent;
  readonly TableBorderTarget: TableBorderTargetNamespace;
  readonly TableBorderColor: TableBorderColorNamespace;
  readonly TableBorderStyle: TableBorderStyleNamespace;
  readonly TableBorderWidth: TableBorderWidthNamespace;
  readonly TableCellFill: TableCellFillNamespace;
  readonly Comments: ToolbarPartComponent;
  readonly FontFamily: typeof FontFamily;
  readonly FontSize: ToolbarSlotPartComponent;
  readonly FontColor: ToolbarColorSplitComponent;
  readonly Highlight: ToolbarColorSplitComponent;
  readonly Zoom: ToolbarSlotPartComponent;
  readonly StylePicker: typeof ParagraphStyle;
  readonly EditingMode: ToolbarSlotPartComponent;
  readonly Reviewers: typeof ToolbarReviewers;
  readonly Save: ToolbarSlotPartComponent;
  readonly ContentControlShowAll: ToolbarPartComponent;
  readonly ContentControlFormFill: ToolbarPartComponent;
  readonly ContentControlInspector: ToolbarPartComponent;
  readonly ContentControlRemove: ToolbarPartComponent;
}

const DocxEditorToolbarRoot = defineComponent({
  name: 'DocxEditorToolbar',
  props: {
    className: { type: String, default: undefined },
    t: { type: Function as PropType<ToolbarTranslate>, default: undefined },
    onSave: { type: Function as PropType<() => void>, default: undefined },
    preset: { type: Boolean, default: true },
    overflow: { type: Boolean, default: true },
  },
  setup(props, { slots }) {
    const scopeClassName = useScopeClassName();
    provide(
      ToolbarContext,
      computed(() => ({ t: props.t, onSave: props.onSave }))
    );
    const label = useToolbarLabel();
    const image = useEditorState(selectToolbarImage);
    const toolbarDisabled = useEditorState(selectToolbarDisabled);
    const tableChromeVisible = useEditorState(selectTableChromeVisible);
    const defaultGroups = computed(() => buildDefaultGroups(image.value));
    const defaultSlots = computed(
      () =>
        new Set(defaultGroups.value.flatMap((group) => group.entries.map((entry) => entry.slot)))
    );
    // Which groups exist depends on the children, which Vue only renders inside `render`. The
    // render writes the answer here and the measuring hook reads it after the render.
    const layout = shallowRef<{ groups: readonly string[]; order: readonly string[] }>({
      groups: [],
      order: [],
    });
    const measuring = computed(() => props.preset && props.overflow);
    const { attach, overflow } = useToolbarOverflow(
      () => measuring.value,
      () => layout.value.groups,
      () => layout.value.order
    );

    return () => {
      const kids = flattenChildren(slots.default?.());
      let content: VNode | VNode[] | null;

      if (!props.preset) {
        content = kids;
      } else {
        const parsed = readToolbarChildren<ArrangementKey>(
          kids,
          slotOfChild,
          (slot) => defaultSlots.value.has(slot),
          (slot) => (TABLE_CHROME_SLOTS as readonly string[]).includes(slot)
        );
        const { overrides, tableOverrides, appended } = parsed;
        const arranged = arrangeGroups(defaultGroups.value, parsed);
        const collapsible = [
          ...arranged.filter((group) => !group.pinned).map((group) => group.id),
          ...(tableChromeVisible.value ? [TABLE_CONTEXTUAL_GROUP_ID] : []),
        ];
        const priorities = new Map<string, number>();
        for (const group of arranged) {
          if (group.priority !== undefined) priorities.set(group.id, group.priority);
        }
        const order = collapseOrder(collapsible, TOOLBAR_COLLAPSE_ORDER, priorities);
        if (
          layout.value.groups.join('\u0000') !== collapsible.join('\u0000') ||
          layout.value.order.join('\u0000') !== order.join('\u0000')
        ) {
          layout.value = { groups: collapsible, order };
        }

        const render = (entry: DefaultEntry) => {
          const override = overrides.get(entry.slot);
          if (override) return override;
          return h(entry.Part);
        };

        const renderTable = (entry: DefaultEntry) => {
          const override = tableOverrides.get(entry.slot);
          if (override) return override;
          return h(entry.Part);
        };

        const bar: VNode[] = [];
        const sections: ToolbarOverflowSection[] = [];
        let drawn = 0;
        for (const group of arranged) {
          if (overflow.value.has(group.id)) {
            const rows = group.entries.flatMap((entry) => {
              const override = overrides.get(entry.slot);
              if (isHiddenOverride(override)) return [];
              // A `Toolbar.Slot` may give its own panel content.
              const panelContent =
                override?.type === ToolbarSlot
                  ? (override.props?.overflowContent ?? override.props?.['overflow-content'])
                  : undefined;
              const row =
                override || isValueSlot(entry.slot) ? (
                  <ToolbarOverflowControl label={labelOf(label, entry, group.labelKey)}>
                    {typeof panelContent === 'function'
                      ? (panelContent as () => VNode)()
                      : render(entry)}
                  </ToolbarOverflowControl>
                ) : (
                  <ToolbarOverflowItem slot={entry.slot as ChromeSlotId} />
                );
              return [<Fragment key={entry.slot}>{row}</Fragment>];
            });
            const extra = hostPanelContent(group);
            if (extra !== null) rows.push(<Fragment key="host">{extra}</Fragment>);
            if (rows.length === 0) continue;
            sections.push({
              id: group.id,
              labelKey: group.labelKey,
              ...(group.heading ? { label: hostGroupText(group.heading, label) } : {}),
              children: rows,
            });
            continue;
          }
          if (drawn > 0) bar.push(h(ToolbarSeparator, { key: `separator-${group.id}` }));
          drawn += 1;
          bar.push(
            h(
              'div',
              {
                key: group.id,
                class: `docx-toolbar__group${group.className ? ` ${group.className}` : ''}`,
                ...(group.heading
                  ? { role: 'group', 'aria-label': hostGroupText(group.heading, label) }
                  : {}),
                ...(group.pinned ? { [FIXED_ATTRIBUTE]: '' } : { [GROUP_ATTRIBUTE]: group.id }),
              },
              [
                ...group.entries.map((entry) => h(Fragment, { key: entry.slot }, [render(entry)])),
                ...(group.extras.length > 0
                  ? [h(Fragment, { key: 'host' }, [...group.extras])]
                  : []),
              ]
            )
          );
        }

        const tableOverflowed = overflow.value.has(TABLE_CONTEXTUAL_GROUP_ID);
        if (tableChromeVisible.value && tableOverflowed) {
          const rows = TABLE_CONTEXTUAL_GROUP.entries.flatMap((entry) => {
            const override = tableOverrides.get(entry.slot);
            if (isHiddenOverride(override)) return [];
            return [
              <Fragment key={entry.slot}>
                <ToolbarOverflowControl
                  label={labelOf(label, entry, TABLE_CONTEXTUAL_GROUP.labelKey)}
                >
                  {renderTable(entry)}
                </ToolbarOverflowControl>
              </Fragment>,
            ];
          });
          if (rows.length > 0) {
            // Keep contextual controls at the top of More. Table pickers render inside the
            // panel, so their trigger must remain visible when opening one temporarily lifts
            // the panel's scroll clipping.
            sections.unshift({
              id: TABLE_CONTEXTUAL_GROUP.id,
              labelKey: TABLE_CONTEXTUAL_GROUP.labelKey,
              children: rows,
            });
          }
        }

        content = [
          ...bar,
          ...(tableChromeVisible.value && !tableOverflowed
            ? [h(ToolbarSeparator, { key: 'separator-contextual-table' })]
            : []),
          ...(!tableOverflowed
            ? [
                h(
                  'div',
                  {
                    class: 'docx-toolbar__contextual',
                    [GROUP_ATTRIBUTE]: TABLE_CONTEXTUAL_GROUP_ID,
                  },
                  h(TableChromeGroup, { overrides: tableOverrides, separator: false })
                ),
              ]
            : []),
          // Loose host children never collapse: they have no group, and so no label for a
          // panel section. A host that wants them to collapse puts them in a Toolbar.Group.
          ...(appended.length > 0
            ? [h('div', { class: 'docx-toolbar__group', [FIXED_ATTRIBUTE]: '' }, [...appended])]
            : []),
          ...(sections.length > 0 ? [h(ToolbarOverflow, { sections })] : []),
        ];
      }

      const needsTableProvider = props.preset || walkForTableChromeParts(kids);

      const inner = needsTableProvider
        ? h(TableChromeProvider, null, {
            default: () => (Array.isArray(content) ? content : [content]),
          })
        : content;

      // The host sits INSIDE the toolbar element and teleports the dialog to the body. A
      // host wrapping the element would make this component's root a fragment, and Vue
      // then drops every fallthrough attribute the host passes — `class`, `style`, `id`.
      return h(
        'fieldset',
        {
          ref: (el: unknown) => attach(el as HTMLFieldSetElement | null),
          disabled: toolbarDisabled.value,
          'aria-label': props.t?.('formattingBar.label') ?? label('formattingBar.label'),
          'data-testid': 'docx-toolbar',
          class: `${scopeClassName}docx-toolbar${props.className ? ` ${props.className}` : ''}`,
          ...(measuring.value ? { 'data-overflow': '' } : {}),
          onMousedown: guardToolbarMousedown,
        },
        [h(ParagraphDialogHost, null, { default: () => [inner] })]
      );
    };
  },
});

type HostGroupHeading = Pick<DocxEditorToolbarGroupProps, 'id' | 'label' | 'labelKey'>;

/** A group as the preset bar renders it: built-in or host-owned, in bar order. */
interface ArrangedGroup {
  readonly id: string;
  /** Panel heading key of a built-in group. */
  readonly labelKey: string;
  /** A host group's heading props, resolved with the toolbar's `t` at render. */
  readonly heading: HostGroupHeading | undefined;
  readonly entries: readonly DefaultEntry[];
  /** Host content: a host group's children, or controls added to a built-in group. */
  readonly extras: readonly VNode[];
  readonly pinned: boolean;
  readonly priority: number | undefined;
  readonly overflowContent: (() => DocxEditorChildren) | undefined;
  readonly className: string | undefined;
  readonly host: boolean;
}

/**
 * The bar's groups: the built-in ones with their `Toolbar.Group` changes applied, and the
 * host's own groups placed by {@link arrangeToolbarGroups}. A group with nothing left to
 * render (hidden, or every slot hidden and no host content) is dropped, so it leaves no
 * empty box and no separator in the bar or the panel.
 */
function arrangeGroups(
  defaultGroups: readonly DefaultGroup[],
  parsed: ToolbarChildren<ArrangementKey>
): readonly ArrangedGroup[] {
  const specs = new Map(parsed.groups.map((spec) => [spec.id, spec]));
  const builtInIds = new Set(defaultGroups.map((group) => group.id));
  const byId = new Map<string, ArrangedGroup>();
  for (const group of defaultGroups) {
    const spec = specs.get(group.id);
    if (spec) warnBuiltInGroupProps(spec);
    if (spec?.hidden) continue;
    const extras = spec?.children ?? [];
    const visible = group.entries.some(
      (entry) => !isHiddenOverride(parsed.overrides.get(entry.slot))
    );
    if (!visible && extras.length === 0) continue;
    byId.set(group.id, {
      id: group.id,
      labelKey: group.labelKey,
      heading: undefined,
      entries: group.entries,
      extras,
      pinned: spec?.pinned ?? TOOLBAR_PINNED_GROUPS.has(group.id),
      priority: spec?.priority,
      overflowContent: spec?.overflowContent,
      className: spec?.className,
      host: false,
    });
  }
  for (const spec of parsed.groups) {
    if (spec.id === TABLE_CONTEXTUAL_GROUP_ID) warnReservedGroupId(spec.id);
  }
  const hosts = parsed.groups.filter(
    (spec) => !builtInIds.has(spec.id) && spec.id !== TABLE_CONTEXTUAL_GROUP_ID
  );
  for (const spec of hosts) {
    if (spec.hidden || !spec.children || spec.children.length === 0) continue;
    byId.set(spec.id, {
      id: spec.id,
      labelKey: spec.labelKey ?? spec.id,
      heading: { id: spec.id, label: spec.label, labelKey: spec.labelKey },
      entries: [],
      extras: spec.children,
      pinned: spec.pinned === true,
      priority: spec.priority,
      overflowContent: spec.overflowContent,
      className: spec.className,
      host: true,
    });
  }
  const known = [...builtInIds, ...hosts.map((spec) => spec.id)];
  for (const spec of hosts) {
    if (spec.after !== undefined && !known.includes(spec.after)) {
      warnUnknownGroupAnchor(spec.id, spec.after, known);
    }
  }
  for (const child of parsed.appended) {
    // A `Toolbar.Slot` exists only to take a slot's place, so landing here is a mistake.
    if (child.type !== ToolbarSlot) continue;
    const slot = String(child.props?.slotId ?? child.props?.['slot-id']) as ChromeSlotId;
    warnSlotOutsideArrangement(slot, chromeControlForSlot(slot) !== null);
  }
  // Placed over EVERY built-in id, hidden ones included, so `after` still finds its anchor.
  const order = arrangeToolbarGroups(
    defaultGroups.map((group) => group.id),
    hosts.map((spec) => ({ id: spec.id, after: spec.after }))
  );
  return order.flatMap((id) => {
    const group = byId.get(id);
    return group ? [group] : [];
  });
}

/** Props of a built-in `Toolbar.Group` that only a host group uses. */
function warnBuiltInGroupProps(
  spec: Pick<DocxEditorToolbarGroupProps, 'id' | 'label' | 'labelKey' | 'after'>
): void {
  for (const setting of ['label', 'labelKey', 'after'] as const) {
    if (spec[setting] !== undefined) warnBuiltInGroupSetting(spec.id, setting);
  }
}

/** A collapsed group's host content in the panel, or null when it has none. */
function hostPanelContent(group: ArrangedGroup): VNode | null {
  // `overflowContent` renders even without children, so a built-in group can add a panel
  // row of its own.
  if (group.overflowContent) return h(Fragment, null, [group.overflowContent() as VNode]);
  if (group.extras.length === 0) return null;
  return h(ToolbarPanelPlacement, null, { default: () => [...group.extras] });
}

function labelOf(
  label: (key: string) => string,
  entry: DefaultEntry,
  groupLabelKey: string
): string {
  const control = entry.slot === 'alignment' ? null : chromeControlForSlot(entry.slot);
  return label(control?.labelKey ?? groupLabelKey);
}

/** @public */
export const DocxEditorToolbar = Object.assign(DocxEditorToolbarRoot, {
  Button: ToolbarButton,
  Action: ToolbarAction,
  Separator: ToolbarSeparator,
  Group: ToolbarHostGroup,
  Slot: ToolbarSlot,
  AddComment: ToolbarAddComment,
  Undo: ToolbarUndo,
  Redo: ToolbarRedo,
  Bold: ToolbarBold,
  Italic: ToolbarItalic,
  Underline: ToolbarUnderline,
  Strike: ToolbarStrike,
  Link: ToolbarLink,
  ClearFormatting: ToolbarClearFormatting,
  Superscript: ToolbarSuperscript,
  Subscript: ToolbarSubscript,
  Alignment: ToolbarAlignment,
  AlignLeft: ToolbarAlignLeft,
  AlignCenter: ToolbarAlignCenter,
  AlignRight: ToolbarAlignRight,
  AlignJustify: ToolbarAlignJustify,
  LeftToRight: ToolbarLeftToRight,
  RightToLeft: ToolbarRightToLeft,
  LineSpacing: ToolbarLineSpacing,
  BulletList: ToolbarBulletList,
  NumberedList: ToolbarNumberedList,
  Outdent: ToolbarOutdent,
  Indent: ToolbarIndent,
  ImageInsert: ToolbarImageInsert,
  ImageWrap: ToolbarImageWrap,
  ImageAltText: ToolbarImageAltText,
  ImageProperties: ToolbarImageProperties,
  TableInsert: ToolbarTableInsert,
  TableBorderTarget: ToolbarTableBorderTarget,
  TableBorderColor: ToolbarTableBorderColor,
  TableBorderStyle: ToolbarTableBorderStyle,
  TableBorderWidth: ToolbarTableBorderWidth,
  TableCellFill: ToolbarTableCellFill,
  Comments: ToolbarComments,
  FontFamily,
  FontSize: ToolbarFontSize,
  FontColor: ToolbarFontColor,
  Highlight: ToolbarHighlight,
  Zoom: ToolbarZoom,
  StylePicker: ParagraphStyle,
  EditingMode: ToolbarEditingMode,
  Reviewers: ToolbarReviewers,
  Save: ToolbarSave,
  ContentControlShowAll: ToolbarContentControlShowAll,
  ContentControlFormFill: ToolbarContentControlFormFill,
  ContentControlInspector: ToolbarContentControlInspector,
  ContentControlRemove: ToolbarContentControlRemove,
}) as unknown as DocxEditorToolbarNamespace;

export { useFontFamily, useParagraphStyle };
