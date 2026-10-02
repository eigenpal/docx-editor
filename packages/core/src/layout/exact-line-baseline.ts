import type { OoxmlElement } from '@docx-editor.dev/core/store';
import { compatibilityProfileFromSettings } from './compatibility/compatibility-profile.ts';

/**
 * The legacy `w:noExtraLineSpacing` switch, which modern compatibility modes ignore. See the
 * `preserveExactLineBaseline` rule in `compatibility/compatibility-rules.ts`.
 */
export function preserveExactLineBaseline(root: OoxmlElement | null): boolean {
  return compatibilityProfileFromSettings(root).has('preserveExactLineBaseline');
}
