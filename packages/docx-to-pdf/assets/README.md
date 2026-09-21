# PDF fallback font assets

These are third-party font assets, not EigenPal code. The Noto faces are under the SIL Open Font License. Twemoji Mozilla (`TwemojiMozilla.ttf`) is the COLR color emoji font from the Mozilla `twemoji-colr` project: its code is under the Apache License 2.0, and its emoji art is Twemoji, used under CC BY 4.0. Their original licenses are in `../licenses/`. `sources.json` records upstream URLs, source SHA-256 values, and installed SHA-256 values.

Noto Emoji and Noto Sans Arabic are static instances produced from the recorded variable sources with FontTools `instantiateVariableFont`, at weight 400 and, for Arabic, width 100. All other faces are unchanged upstream binaries. No document- specific subset ships here; PDF embedding subsets each actual export.

These files load locally. Export does not download fonts. The font resolver may also read installed Word fonts from fixed OS locations. Those fonts are not redistributed.
