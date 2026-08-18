import {
  computed,
  defineComponent,
  Fragment,
  h,
  provide,
  type Component,
  type PropType,
  type VNode,
} from 'vue';
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
import { ToolbarContext, useToolbarLabelFor, type ToolbarTranslate } from './toolbar-context';
import { ToolbarButton, chromeControlForSlot, guardToolbarMousedown } from './ToolbarButton';
import {
  ToolbarOverflow,
  ToolbarOverflowControl,
  ToolbarOverflowItem,
  type ToolbarOverflowSection,
} from './ToolbarOverflow';
import { collapseOrder, TOOLBAR_PINNED_GROUPS } from './toolbar-overflow';
import { FIXED_ATTRIBUTE, GROUP_ATTRIBUTE, useToolbarOverflow } from './useToolbarOverflow';
import { ToolbarImageInsert, ToolbarImageWrap, ToolbarImageAltText } from '../images';
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
  ToolbarLink,
  ToolbarNumberedList,
  ToolbarOutdent,
  ToolbarRedo,
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
import { TableChromeProvider } from './useTableChrome';
import { ToolbarEditingMode } from './EditingMode';

const TABLE_CHROME_SLOTS: readonly ArrangementKey[] = [
  'table.borderTarget',
  'table.borderColor',
  'table.borderStyle',
  'table.borderWidth',
  'table.cellFill',
];

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

const iconPartCache = new Map<ChromeSlotId, PartLike>();
function iconPart(slot: ChromeSlotId): PartLike {
  let part = iconPartCache.get(slot);
  if (!part) {
    part = defineComponent({
      name: `ToolbarIconPart_${slot.replace(/\./g, '_')}`,
      props: { hidden: { type: Boolean, default: undefined } },
      setup(props) {
        return () => h(ToolbarButton, { slot, hidden: props.hidden });
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

function isValueSlot(slot: ArrangementKey): boolean {
  return slot === 'alignment' || slot in SHAPED_PARTS;
}

function slotOfChild(child: VNode): ArrangementKey | null {
  const unwrapped = unwrapFragment(child, slotOfChild);
  if (unwrapped !== null) return unwrapped as ArrangementKey;
  const slot = docxSlotOf(child);
  if (slot) return slot as ArrangementKey;
  const type = child.type;
  if (typeof type === 'object' && type !== null && 'docxToolbarPart' in type) {
    const slotProp = child.props?.slot;
    if (typeof slotProp === 'string') return slotProp as ArrangementKey;
  }
  return null;
}

function isHiddenOverride(vnode: VNode | undefined): boolean {
  if (!vnode) return false;
  return Boolean(vnode.props?.hidden);
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
  children?: VNode;
}

/** @public */
export interface DocxEditorToolbarNamespace {
  (props: DocxEditorToolbarProps): VNode;
  readonly Button: typeof ToolbarButton;
  readonly Action: typeof ToolbarAction;
  readonly Separator: typeof ToolbarSeparator;
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
  readonly LineSpacing: ToolbarSlotPartComponent;
  readonly BulletList: ToolbarPartComponent;
  readonly NumberedList: ToolbarPartComponent;
  readonly Outdent: ToolbarPartComponent;
  readonly Indent: ToolbarPartComponent;
  readonly ImageInsert: ToolbarPartComponent;
  readonly ImageWrap: typeof ToolbarImageWrap;
  readonly ImageAltText: typeof ToolbarImageAltText;
  readonly ImageProperties: typeof ToolbarImageProperties;
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
    provide(ToolbarContext, { t: props.t, onSave: props.onSave });
    const label = useToolbarLabelFor(props.t);
    const image = useEditorState(selectToolbarImage);
    const defaultGroups = computed(() => buildDefaultGroups(image.value));
    const defaultSlots = computed(
      () =>
        new Set(defaultGroups.value.flatMap((group) => group.entries.map((entry) => entry.slot)))
    );
    const collapsible = computed(() =>
      defaultGroups.value.map((group) => group.id).filter((id) => !TOOLBAR_PINNED_GROUPS.has(id))
    );
    const collapseOrderIds = computed(() => collapseOrder(collapsible.value));
    const measuring = computed(() => props.preset && props.overflow);
    const { attach, overflow } = useToolbarOverflow(
      () => measuring.value,
      () => collapsible.value,
      () => collapseOrderIds.value
    );

    return () => {
      const kids = flattenChildren(slots.default?.());
      let content: VNode | VNode[] | null;

      if (!props.preset) {
        content = kids;
      } else {
        const overrides = new Map<ArrangementKey, VNode>();
        const tableOverrides = new Map<ArrangementKey, VNode>();
        const appended: VNode[] = [];
        for (const child of kids) {
          const slot = slotOfChild(child);
          if (slot && defaultSlots.value.has(slot)) overrides.set(slot, child);
          else if (slot && (TABLE_CHROME_SLOTS as readonly string[]).includes(slot))
            tableOverrides.set(slot, child);
          else appended.push(child);
        }

        const render = (entry: DefaultEntry) => {
          const override = overrides.get(entry.slot);
          if (override) return override;
          return h(entry.Part);
        };

        const bar: VNode[] = [];
        const sections: ToolbarOverflowSection[] = [];
        let drawn = 0;
        for (const group of defaultGroups.value) {
          if (overflow.value.has(group.id)) {
            const rows = group.entries.flatMap((entry) => {
              const override = overrides.get(entry.slot);
              if (isHiddenOverride(override)) return [];
              const row =
                override || isValueSlot(entry.slot) ? (
                  <ToolbarOverflowControl label={labelOf(label, entry, group.labelKey)}>
                    {render(entry)}
                  </ToolbarOverflowControl>
                ) : (
                  <ToolbarOverflowItem slot={entry.slot as ChromeSlotId} />
                );
              return [<Fragment key={entry.slot}>{row}</Fragment>];
            });
            if (rows.length === 0) continue;
            sections.push({ id: group.id, labelKey: group.labelKey, children: rows });
            continue;
          }
          if (drawn > 0) bar.push(h(ToolbarSeparator, { key: `separator-${group.id}` }));
          drawn += 1;
          const pinned = TOOLBAR_PINNED_GROUPS.has(group.id);
          bar.push(
            h(
              'div',
              {
                key: group.id,
                class: 'docx-toolbar__group',
                ...(pinned ? { [FIXED_ATTRIBUTE]: '' } : { [GROUP_ATTRIBUTE]: group.id }),
              },
              group.entries.map((entry) => h(Fragment, { key: entry.slot }, [render(entry)]))
            )
          );
        }

        content = [
          ...bar,
          h(TableChromeGroup, { overrides: tableOverrides }),
          ...(appended.length > 0
            ? [h('div', { class: 'docx-toolbar__group', [FIXED_ATTRIBUTE]: '' }, appended)]
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

      return h(
        'div',
        {
          ref: (el: unknown) => attach(el as HTMLDivElement | null),
          role: 'toolbar',
          'data-testid': 'docx-toolbar',
          class: `${scopeClassName}docx-toolbar${props.className ? ` ${props.className}` : ''}`,
          ...(measuring.value ? { 'data-overflow': '' } : {}),
          onMousedown: guardToolbarMousedown,
        },
        [inner]
      );
    };
  },
});

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
  Save: ToolbarSave,
  ContentControlShowAll: ToolbarContentControlShowAll,
  ContentControlFormFill: ToolbarContentControlFormFill,
  ContentControlInspector: ToolbarContentControlInspector,
  ContentControlRemove: ToolbarContentControlRemove,
}) as unknown as DocxEditorToolbarNamespace;

export { useFontFamily, useParagraphStyle };
