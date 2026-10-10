## 1. OMML projection

- [x] 1.1 Add bounded OMML expression projection with text fallback
- [x] 1.2 Add linear-math parsing and OMML serialization for the supported subset
- [x] 1.3 Add projector and parser tests for sample, malformed, and hostile inputs

## 2. Layout and paint

- [x] 2.1 Publish each inline equation as one model atom with deterministic geometry
- [x] 2.2 Paint fraction, radical, script, and n-ary expression boxes safely
- [x] 2.3 Add sample layout, paint, offset, and round-trip tests

## 3. Editing

- [x] 3.1 Add atomic equation replace and remove tree operations
- [x] 3.2 Add equation discovery, selection, click activation, and surface operations
- [x] 3.3 Add editor operation and undo tests

## 4. Adapter chrome

- [x] 4.1 Add shared i18n strings and styles for equation editing
- [x] 4.2 Add the default React equation popover and behavior tests
- [x] 4.3 Add the equivalent Vue equation popover and parity tests

## 5. Verification

- [x] 5.1 Run focused equation tests and package type checks
- [x] 5.2 Run formatting, lint, parity, API, i18n, and strict OpenSpec validation
- [x] 5.3 Add a minor changeset for additive equation support
