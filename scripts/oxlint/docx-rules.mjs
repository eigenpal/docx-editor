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
  },
};
