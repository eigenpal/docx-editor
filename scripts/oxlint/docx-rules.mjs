// Repository lint rules that oxlint has no built-in for. ESLint expressed them as
// `no-restricted-syntax` selectors; oxlint has no such rule, so each concern is its own rule
// here, with the same selectors and messages.
//
// One rule per concern also removes a trap the ESLint config had to work around. There, every
// block that set `no-restricted-syntax` REPLACED the earlier value, so a block that added one
// selector had to restate the security-sink selectors or drop them for its files. Here a block
// turns on the rules it needs without touching the others. Override order still matters for the
// test exemption: `.oxlintrc.json` turns the sink rules off for tests, and the adapter blocks
// after it turn them back on for their own tests. A new adapter block must do the same.
//
// oxlint runs JavaScript plugins in alpha, outside semver. `scripts/__tests__/oxlint-rules.test.ts`
// lints a fixture of every banned shape, so a version that stops running these rules fails CI.

/** Report every node a selector matches. */
function selectorRule(selectors) {
  return {
    create(context) {
      const visitors = {};
      for (const { selector, message } of selectors) {
        visitors[selector] = (node) => context.report({ node, message });
      }
      return visitors;
    },
  };
}

// Security sinks (AGENTS.md, "No HTML from strings"): every value from a DOCX, pasted HTML or
// embedded part is attacker-controlled, so file-derived strings must never reach an HTML parser.
const NO_HTML_SINK_MSG =
  'No HTML from strings: file-derived values must not reach an HTML parser. ' +
  'Use createElement(NS) + setAttribute/textContent. See AGENTS.md "Security".';

// `@keyframes` names are document-global. The shipped stylesheet's namespace guard
// (scripts/core-css-assertions.mjs) cannot see CSS a component injects from a <style>
// element, which is how an unprefixed `@keyframes slideIn` shipped and collided with host
// apps (#485). Any `@keyframes <name>` in a string or template literal needs the prefix.
const NO_GLOBAL_KEYFRAMES_MSG =
  '@keyframes names are document-global. Give the name a docx-/hf- prefix, or move the ' +
  'keyframes — under a docx-/hf- prefixed name, since inline animation references are ' +
  'not rewritten by the build — into packages/core/src/styles/editor.css where the ' +
  'namespace guard (scripts/core-css-assertions.mjs) covers it.';

// A file-controlled collection spread into varargs (`push(...arr)`) grows the argument stack
// with the document and throws on attacker-sized input. `push`/`splice`/`Math.*` call shapes
// are grandfathered as human judgment (72 audited sites, all bounded).
const VARARGS_CALL_MSG =
  'Spreading an array into a call grows the argument stack with the document ' +
  'and throws on attacker-sized input. Iterate, or pass the array itself. ' +
  'push/splice/Math.* sites are grandfathered — audit that the collection is ' +
  'bounded before adding one.';
const VARARGS_NEW_MSG =
  'Spreading an array into a constructor grows the argument stack with the ' +
  'document and throws on attacker-sized input. Pass the array itself ' +
  '(new Set(items), not new Set(...items)).';

// Layout branches on the Word compatibility mode only through named rules
// (packages/core/src/layout/compatibility/compatibility-rules.ts), so one registry says which
// behavior depends on which mode. A raw comparison such as `compatibilityMode >= 15` or
// `[11, 12, 14].includes(compatibilityMode)` bypasses it and is how quirky predicates spread.
const RAW_COMPATIBILITY_MODE_MSG =
  'Do not compare compatibilityMode (or a `mode` alias of it) with numbers. Register a named rule in ' +
  'packages/core/src/layout/compatibility/compatibility-rules.ts and call ' +
  "hasCompatibilityRule(compatibilityMode, 'ruleName'). See docs/architecture/compatibility-modes.md.";

// A destructured alias is usually a local `mode` (`const { compatibilityMode: mode } = table`),
// so that variable name counts too. A `mode` property (`stat.mode`) does not.
const MODE_NAME = '/^(compatibilityMode|mode)$/';

/** Selectors for an expression that reads the mode, directly or as `mode ?? n`. */
function compatibilityModeOperands(side) {
  return [
    `[${side}.name=${MODE_NAME}]`,
    `[${side}.property.name='compatibilityMode']`,
    `[${side}.type='LogicalExpression'][${side}.left.name=${MODE_NAME}]`,
    `[${side}.type='LogicalExpression'][${side}.left.property.name='compatibilityMode']`,
  ];
}

const NUMERIC_COMPARISON = 'BinaryExpression[operator=/^([<>]=?|[!=]==?)$/]';
const NUMERIC_LIST_INCLUDES =
  "CallExpression[callee.property.name='includes'][callee.object.type='ArrayExpression']" +
  "[callee.object.elements.0.type='Literal'][callee.object.elements.0.raw=/^[0-9]/]";
const RAW_COMPATIBILITY_MODE_SELECTORS = [
  ...compatibilityModeOperands('left').map(
    (operand) => `${NUMERIC_COMPARISON}${operand}[right.type='Literal'][right.raw=/^[0-9]/]`
  ),
  ...compatibilityModeOperands('right').map(
    (operand) => `${NUMERIC_COMPARISON}${operand}[left.type='Literal'][left.raw=/^[0-9]/]`
  ),
  // Any list may hold the mode itself; a list of numbers may hold it under the `mode` alias.
  "CallExpression[callee.property.name='includes'][arguments.0.name='compatibilityMode']",
  "CallExpression[callee.property.name='includes'][arguments.0.property.name='compatibilityMode']",
  `${NUMERIC_LIST_INCLUDES}[arguments.0.name='mode']`,
  "SwitchStatement[discriminant.name='compatibilityMode']",
  "SwitchStatement[discriminant.property.name='compatibilityMode']",
];

// Vue chrome passes children to its own components as FUNCTION slots. A JSX child list on a
// component tag reaches Vue as a non-function default slot: Vue normalizes it once and hands
// the same vnodes to every later render. When the component mounts those children again, and a
// server-rendered host has switched Vue to its hydration renderer, the reused vnodes hydrate
// against the wrong DOM (packages/vue/test/hydration-renderer-slots.test.ts).
const VUE_ARRAY_SLOT_MSG =
  'Pass component children as a function slot: <X>{{ default: () => children }}</X>. ' +
  'A JSX child list is a non-function slot, whose reused vnodes break under the hydration ' +
  'renderer. See packages/vue/test/hydration-renderer-slots.test.ts.';

/** Vue built-ins that take raw children, not slots. */
const VUE_RAW_CHILDREN = new Set(['Teleport', 'KeepAlive', 'Suspense', 'Fragment']);

function isComponentTag(name) {
  if (name.type === 'JSXIdentifier')
    return /^[A-Z]/.test(name.name) && !VUE_RAW_CHILDREN.has(name.name);
  return name.type === 'JSXMemberExpression';
}

function isWhitespaceText(child) {
  return child.type === 'JSXText' && child.value.trim() === '';
}

const vueFunctionSlots = {
  create(context) {
    return {
      JSXElement(node) {
        if (!isComponentTag(node.openingElement.name)) return;
        const children = node.children.filter((child) => !isWhitespaceText(child));
        if (children.length === 0) return;
        const only = children.length === 1 ? children[0] : null;
        if (only?.type === 'JSXExpressionContainer' && only.expression.type === 'ObjectExpression')
          return;
        context.report({ node: node.openingElement, message: VUE_ARRAY_SLOT_MSG });
      },
    };
  },
};

export default {
  meta: { name: 'docx' },
  rules: {
    'no-html-sinks': selectorRule([
      {
        selector: "AssignmentExpression[left.property.name='innerHTML']",
        message: NO_HTML_SINK_MSG,
      },
      {
        selector: "AssignmentExpression[left.property.name='outerHTML']",
        message: NO_HTML_SINK_MSG,
      },
      {
        selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
        message: NO_HTML_SINK_MSG,
      },
      {
        selector: "CallExpression[callee.object.name='document'][callee.property.name='write']",
        message: NO_HTML_SINK_MSG,
      },
      // `someWindow.document.write(...)` — the popup variant.
      {
        selector:
          "CallExpression[callee.object.property.name='document'][callee.property.name='write']",
        message: NO_HTML_SINK_MSG,
      },
    ]),

    'no-global-keyframes': selectorRule([
      {
        selector: 'TemplateElement[value.raw=/@(-\\w+-)?keyframes\\s+(?!docx-|hf-)/]',
        message: NO_GLOBAL_KEYFRAMES_MSG,
      },
      {
        selector: 'Literal[value=/@(-\\w+-)?keyframes\\s+(?!docx-|hf-)/]',
        message: NO_GLOBAL_KEYFRAMES_MSG,
      },
    ]),

    'no-varargs-spread': selectorRule([
      {
        selector:
          "CallExpression:not([callee.object.name='Math'])" +
          ":not([callee.property.name='push'])" +
          ":not([callee.property.name='splice'])" +
          ' > SpreadElement',
        message: VARARGS_CALL_MSG,
      },
      // `new Foo(...arr)` is not a CallExpression, so it needs its own selector.
      { selector: 'NewExpression > SpreadElement', message: VARARGS_NEW_MSG },
    ]),

    'vue-function-slots': vueFunctionSlots,

    'no-raw-compatibility-mode': selectorRule(
      RAW_COMPATIBILITY_MODE_SELECTORS.map((selector) => ({
        selector,
        message: RAW_COMPATIBILITY_MODE_MSG,
      }))
    ),
  },
};
