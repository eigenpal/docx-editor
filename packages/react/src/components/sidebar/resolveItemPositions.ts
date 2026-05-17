// React-specific wrapper: typed against ReactSidebarItem (carries the
// React-only `render` prop). The pure layout algorithm lives in core.
import type { ReactSidebarItem } from '../../plugin-api/types';
import {
  resolveItemPositions as coreResolveItemPositions,
  type ResolvedPosition as CoreResolvedPosition,
} from '@eigenpal/docx-editor-core/plugin-api/resolveItemPositions';

export type ResolvedPosition = CoreResolvedPosition<ReactSidebarItem>;

export const resolveItemPositions = coreResolveItemPositions<ReactSidebarItem>;
