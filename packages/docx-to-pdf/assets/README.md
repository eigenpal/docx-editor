# PDF fallback fonts

These third-party fonts load from local files. Conversion does not download fonts. The resolver can also use installed fonts from supported operating system directories; installed fonts are not redistributed.

The Noto fonts use the SIL Open Font License. Twemoji Mozilla uses the Apache License 2.0 for code and CC BY 4.0 for emoji artwork. Original licenses are in [`../licenses/`](../licenses/). [`sources.json`](sources.json) records source URLs and SHA-256 hashes.

Noto Emoji and Noto Sans Arabic are static instances generated with FontTools `instantiateVariableFont` at weight 400. The Arabic instance also uses width 100. The remaining fonts are unchanged upstream binaries. PDF export creates subsets for each document.
