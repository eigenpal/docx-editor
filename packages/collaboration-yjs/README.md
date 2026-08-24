# `@docx-editor.dev/collaboration-yjs`

Experimental Yjs synchronization for text insertion and deletion in existing DOCX body
paragraphs.

This package proves the collaboration boundary. It does not synchronize structural edits,
formatting, tables, headers, footers, notes, images, comments, or tracked changes.

The default entry owns no network provider. Import `@docx-editor.dev/collaboration-yjs/webrtc`
for the peer-to-peer demonstration helper.
