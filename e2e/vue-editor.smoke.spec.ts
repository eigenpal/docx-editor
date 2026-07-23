// Vue adapter EditorDriver browser smoke test (queue item 3). Same flow as React — the
// paired checkpoint is incomplete if only one adapter works.
import { editorSmoke } from './editorSmoke.ts';

editorSmoke('vue', 'http://localhost:5274');
