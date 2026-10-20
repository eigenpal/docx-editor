# Compatibility fixtures

`content.docx` is synthetic. It contains plain and formatted text, a table, tracked
insertion and deletion, a comment with anchors, and an opaque embedded binary part.
Its first paragraph is `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789`.

`collaboration:catalog --capture <version>` opens this document with the actual npm
release. It adds and deletes text to create real editing history, then saves the Yjs
state and expected document content. The catalog records all hashes.

Keep captured release files immutable. Add new scenarios or new fixture families
when coverage grows; do not regenerate historical state with current code.
