// Vue mirror of packages/react/src/components/sidebar/resolveItemPositions.ts.
// React typed against ReactSidebarItem (which carries the React-only
// `render: (props) => ReactNode` field); Vue uses CommentSidebarItem
// (the data-only shape from useCommentSidebarItems). The pure layout
// algorithm lives in core.
import type { CommentSidebarItem } from '../../composables/useCommentSidebarItems';
import {
  resolveItemPositions as coreResolveItemPositions,
  type ResolvedPosition as CoreResolvedPosition,
} from '@eigenpal/docx-editor-core/plugin-api/resolveItemPositions';

export type ResolvedPosition = CoreResolvedPosition<CommentSidebarItem>;
export const resolveItemPositions = coreResolveItemPositions<CommentSidebarItem>;
