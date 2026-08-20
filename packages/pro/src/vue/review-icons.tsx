/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/

import { h, type VNode } from 'vue';
import type { ReviewItemView } from './useReview.ts';

export const icon = (path: string): VNode =>
  h(
    'svg',
    { viewBox: '0 -960 960 960', width: 16, height: 16, ariaHidden: true, focusable: false },
    [h('path', { d: path, fill: 'currentColor' })]
  );

export const ADD_COMMENT_ICON =
  'M440-400h80v-120h120v-80H520v-120h-80v120H320v80h120v120ZM80-80v-720q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v480q0 33-23.5 56.5T800-240H240L80-80Zm126-240h594v-480H160v525l46-45Zm-46 0v-480 480Z';
export const COMMENT_ICON =
  'M240-400h480v-80H240v80Zm0-120h480v-80H240v80Zm0-120h480v-80H240v80ZM880-80 720-240H160q-33 0-56.5-23.5T80-320v-480q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v720ZM160-320h594l46 45v-525H160v480Zm0 0v-480 480Z';
export const COMMENT_OUTLINE_ICON =
  'M880-80 720-240H160q-33 0-56.5-23.5T80-320v-480q0-33 23.5-56.5T160-880h640q33 0 56.5 23.5T880-800v720ZM160-320h594l46 45v-525H160v480Zm0 0v-480 480Z';
export const ACCEPT_ICON = 'M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z';

export const resolvedCommentIcon = (): VNode =>
  h('span', { class: 'docx-review__resolved-icon' }, [
    h('span', { class: 'docx-review__resolved-comment' }, [icon(COMMENT_OUTLINE_ICON)]),
    h('span', { class: 'docx-review__resolved-tick' }, [icon(ACCEPT_ICON)]),
  ]);

export const REOPEN_ICON =
  'M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z';
export const REJECT_ICON =
  'm256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z';
export const DELETE_ICON =
  'M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z';
export const INSERT_ICON =
  'M200-200h57l391-391-57-57-391 391v57Zm-80 80v-170l528-527q12-11 26.5-17t30.5-6q16 0 31 6t26 18l55 56q12 11 17.5 26t5.5 30q0 16-5.5 30.5T817-647L290-120H120Zm640-584-56-56 56 56Zm-141 85-28-29 57 57-29-28Z';
export const DELETE_REVISION_ICON =
  'M486-160q-76 0-135-45t-85-123l88-38q14 48 48.5 78t85.5 30q42 0 76-20t34-64q0-18-7-33t-19-27h112q5 14 7.5 28.5T694-341q0 86-61.5 133.5T486-160ZM80-520v-80h800v80H80Zm402-360q66 0 116 30t74 84l-88 38q-11-28-38.5-47T480-794q-42 0-72 19t-30 51q0 15 6 27t18 22H272q-6-13-9-27t-3-30q0-70 55-114t167-44Z';
export const FORMAT_ICON =
  'M360-160q-83 0-141.5-58.5T160-360v-360q0-83 58.5-141.5T360-920q83 0 141.5 58.5T560-720v360q0 83-58.5 141.5T360-160Zm0-80q50 0 85-35t35-85v-360q0-50-35-85t-85-35q-50 0-85 35t-35 85v360q0 50 35 85t85 35Zm300 80q29 0 49.5-20.5T730-230q0-22-12.5-40T684-296l-64-32v-232l100 100q23 23 51.5 35.5T832-412v-80q-17 0-32-6.5T773-517L633-657q-12-12-27.5-17.5T573-680h-13v520h100ZM360-720Z';
export const CUSTOM_ICON =
  'M580-360q-25 0-42.5-17.5T520-420v-160q0-25 17.5-42.5T580-640h160q25 0 42.5 17.5T800-580v260q0 66-47 113t-113 47v-80q33 0 56.5-23.5T720-320v-40H580Zm-360 0q-25 0-42.5-17.5T160-420v-160q0-25 17.5-42.5T220-640h160q25 0 42.5 17.5T440-580v260q0 66-47 113t-113 47v-80q33 0 56.5-23.5T360-320v-40H220Z';

export function markerIconPath(entry: ReviewItemView): string {
  if (entry.kind === 'comment') return COMMENT_ICON;
  if (entry.kind === 'custom') {
    return (entry.item as { icon?: string }).icon ?? CUSTOM_ICON;
  }
  switch (entry.revisionKind) {
    case 'insert':
    case 'moveTo':
      return INSERT_ICON;
    case 'delete':
    case 'moveFrom':
      return DELETE_REVISION_ICON;
    case 'format':
      return FORMAT_ICON;
    default:
      return COMMENT_ICON;
  }
}
