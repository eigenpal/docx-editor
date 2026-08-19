#!/usr/bin/env node
/**
 * Ports TableControls.tsx from React to Vue TSX (one-off helper).
 * Run from repo root: node scripts/port-table-controls.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const reactPath = path.join('packages/react/src/editor/toolbar/TableControls.tsx');
const outPath = path.join('packages/vue/src/editor/toolbar/TableControls.tsx');

let s = fs.readFileSync(reactPath, 'utf8');

// React types -> Vue
s = s.replace(/ReactNode/g, 'VNode');
s = s.replace(/React\.ReactElement/g, 'VNode');

// Fix destructuring `class` prop back to className (react used className, perl may have broken)
s = s.replace(/\{ hidden, asChild, class, children \}/g, '{ hidden, asChild, className, children }');
s = s.replace(/\{ asChild, class, children \}/g, '{ asChild, className, children }');
s = s.replace(/class \? ` \$\{class\}`/g, 'className ? ` ${className}`');
s = s.replace(/`\$\{classBase\}\$\{class \?/g, '`${classBase}${className ?');

// Vue imports
s = s.replace(
  /import \{[\s\S]*?\} from 'react';/,
  `import {
  computed,
  defineComponent,
  Fragment,
  inject,
  provide,
  ref,
  watch,
  type ComputedRef,
  type InjectionKey,
  type PropType,
  type Ref,
  type VNode,
  type KeyboardEvent,
} from 'vue';`
);

// createContext pattern -> InjectionKey
s = s.replace(
  /function createTableSlotContext\(\) \{\s*return createContext<TableSlotContextValue \| null>\(null\);\s*\}/,
  `function createTableSlotContext(): InjectionKey<TableSlotContextValue> {
  return Symbol('TableSlotContext') as InjectionKey<TableSlotContextValue>;
}`
);

s = s.replace(
  /function useTableSlotContext\(\s*ctx: ReturnType<typeof createTableSlotContext>\s*\): TableSlotContextValue \{\s*const value = useContext\(ctx\);\s*if \(!value\) throw new Error\('table chrome compound part used outside its root'\);\s*return value;\s*\}/,
  `function useTableSlotContext(ctx: InjectionKey<TableSlotContextValue>): TableSlotContextValue {
  const value = inject(ctx, null);
  if (!value) throw new Error('table chrome compound part used outside its root');
  return value;
}`
);

// useTableChromeSlot destructure -> computed refs
s = s.replace(
  /const \{ visible, enabled, disabledReason, draft, apply \} = useTableChromeSlot\(slot\);/g,
  `const chrome = useTableChromeSlot(slot);`
);

s = s.replace(/if \(hidden \|\| !visible\) return null;/g, 'if (props.hidden || !chrome.visible.value) return null;');
s = s.replace(/if \(hidden \|\| !visible\) return null/g, 'if (props.hidden || !chrome.visible.value) return null');

// useState -> ref (simple cases)
s = s.replace(/const \[open, setOpen\] = useState\(false\);/g, 'const open = ref(false);\n    const setOpen = (v: boolean) => { open.value = v; };');
s = s.replace(/const \[lastHex, setLastHex\] = useState\(defaultHex\);/g, 'const lastHex = ref(defaultHex);\n    const setLastHex = (v: string) => { lastHex.value = v; };');

// useRef -> ref
s = s.replace(/const rootRef = useRef<HTMLDivElement \| null>\(null\);/g, 'const rootRef = ref<HTMLDivElement | null>(null);');
s = s.replace(/const triggerRef = useRef<HTMLButtonElement \| null>\(null\);/g, 'const triggerRef = ref<HTMLButtonElement | null>(null);');
s = s.replace(/const panelRef = useRef<HTMLDivElement \| null>\(null\);/g, 'const panelRef = ref<HTMLDivElement | null>(null);');
s = s.replace(/const dialogRef = useRef<HTMLDivElement \| null>\(null\);/g, 'const dialogRef = ref<HTMLDivElement | null>(null);');

// useDropdownClose(open, setOpen, rootRef) -> useDropdownClose(open, setOpen, rootRef) works with Ref

// useMemo for context value - inline in provide
s = s.replace(
  /const value = useMemo<TableSlotContextValue>\(\s*\(\) => \(\{ open, setOpen, enabled, disabledReason, apply, draft, triggerRef \}\),\s*\[open, enabled, disabledReason, apply, draft\]\s*\);/g,
  `const slotCtx: TableSlotContextValue = {
      get open() { return open.value; },
      setOpen,
      get enabled() { return chrome.enabled.value; },
      get disabledReason() { return chrome.disabledReason.value; },
      apply: chrome.apply,
      draft: chrome.draft,
      triggerRef,
    };
    provide(Ctx, slotCtx);`
);

// Color split useMemo with lastHex
s = s.replace(
  /const value = useMemo<TableSlotContextValue>\(\s*\(\) => \(\{\s*open,\s*setOpen,\s*enabled,\s*disabledReason,\s*apply,\s*draft,\s*triggerRef,\s*lastHex,\s*setLastHex,\s*\}\),\s*\[open, enabled, disabledReason, apply, draft, lastHex\]\s*\);/g,
  `const slotCtx: TableSlotContextValue = {
      get open() { return open.value; },
      setOpen,
      get enabled() { return chrome.enabled.value; },
      get disabledReason() { return chrome.disabledReason.value; },
      apply: chrome.apply,
      draft: chrome.draft,
      triggerRef,
      get lastHex() { return lastHex.value; },
      setLastHex,
    };
    provide(Ctx, slotCtx);`
);

// Remove Ctx.Provider wrapper - already provide in setup; convert function components to defineComponent is manual below

// useTableChromeProviderVisible
s = s.replace(
  /const visible = useTableChromeProviderVisible\(\);\s*if \(!visible\) return null;/,
  `const visible = useTableChromeProviderVisible();
  if (!visible.value) return null;`
);

// enabled/disabledReason/open/draft access in child components - need .value for refs from chrome
// Trigger: enabled -> chrome.enabled.value via slotCtx getters

// TableSlotContextValue draft type
s = s.replace(
  /readonly draft: ReturnType<typeof useTableChromeSlot>\['draft'\];/,
  'readonly draft: ComputedRef<import("@docx-editor.dev/core/editor").TableChromeDraft>;'
);

// Fix useTableChromeTriggerA11y calls - enabled may be ComputedRef in slot ctx - use getters in slotCtx

// Convert function Root to defineComponent - mark for manual: wrap buildMenuCompound functions

// Replace Ctx.Provider blocks
s = s.replace(
  /<Ctx\.Provider value=\{value\}>\s*\{asChild \? \(\s*<Slot \{\.\.\.shared\} ref=\{rootRef as never\}>\s*\{body\}\s*<\/Slot>\s*\) : \(\s*<div ref=\{rootRef\} \{\.\.\.shared\}>\s*\{body\}\s*<\/div>\s*\)\}\s*<\/Ctx\.Provider>/g,
  `{asChild ? (
          <Slot {...shared} ref={rootRef}>{body}</Slot>
        ) : (
          <div ref={rootRef} {...shared}>{body}</div>
        )}`
);

// enabled in triggerKeyboardToggle and props - from slot context getters (plain boolean)

// useTableMenuKeyboard(open && enabled, ...) -> open.value && slotCtx.enabled
s = s.replace(/useTableMenuKeyboard\(open && enabled,/g, 'useTableMenuKeyboard(open.value && slotCtx.enabled,');
s = s.replace(/useTableDialogKeyboard\(open && enabled,/g, 'useTableDialogKeyboard(open.value && slotCtx.enabled,');

// Fix aria-expanded={open} -> open.value in JSX - global for open ref
s = s.replace(/'aria-expanded': open,/g, "'aria-expanded': open.value,");
s = s.replace(/aria-expanded=\{open\}/g, 'aria-expanded={open.value}');
s = s.replace(/if \(!open \|\| !enabled\) return null;/g, 'if (!open.value || !slotCtx.enabled) return null;');

// draft.spec access - draft is ComputedRef
s = s.replace(/draft\.spec\./g, 'draft.value.spec.');
s = s.replace(/draft\.activeTarget/g, 'draft.value.activeTarget');

// export useTableBorderTargetLabel from separate file
s = s.replace(
  /export function useTableBorderTargetLabel\(\): string \{[\s\S]*?\n\}/,
  `export { useTableBorderTargetLabel } from './useTableBorderTargetLabel';`
);

fs.writeFileSync(outPath, s);
console.log('Wrote', outPath);
