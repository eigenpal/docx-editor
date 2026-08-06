---
'@docx-editor.dev/core': minor
---

Custom nodes can carry a payload larger than the 64-character `w:tag` cap, in a customXml data part an SDT binds to.

- `withCustomXmlDataPart` / `findCustomXmlDataPart` / `customXmlDataParts` author and locate a store: the payload part, its properties, both relationships and the content type, matching what Word writes.
- `withCustomXmlNode` / `readCustomXmlNode` / `withoutCustomXmlNode` manage the nodes inside one, and `customXmlLabelXPath` / `customXmlPrefixMappings` build the address a `w:dataBinding` quotes.
- `withoutOrphanCustomXmlNodes` drops nodes nothing binds any more, which is the only way to collect a payload whose control was deleted in Word.
- `withoutCustomXmlDataPart` removes a store completely, for hosts that need a node type to leave no record in a file exported outside the system.
- `withoutPart` and `withRelationshipsPartFor` are the package primitives this needed: removing a part along with its relationships, `.rels` and content-type Override, and giving a newly created part a `.rels` of its own.
