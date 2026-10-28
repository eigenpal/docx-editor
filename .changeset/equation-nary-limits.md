---
'@docx-editor.dev/core': minor
---

Inline equations place n-ary limits to the right of the operator as a subscript and superscript, display equations follow `m:limLoc`, and an n-ary with an `m:limLoc` of `subSup` displays as math; `EquationExpression` n-ary structures carry it as `limitLocation`. Fixes #1543.
