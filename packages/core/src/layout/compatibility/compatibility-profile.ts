// A document's compatibility profile: its mode and every cataloged compatibility option, read
// once from `settings.xml`, and the rules they turn on.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import {
  compatibilityModeClass,
  compatibilityModeValue,
  readWordCompatibilityMode,
  type CompatibilityModeClass,
  type WordCompatibilityMode,
} from './compatibility-mode.ts';
import { readCompatibilityOptions, type CompatibilityOptions } from './compatibility-settings.ts';
import {
  MODE_COMPATIBILITY_RULES,
  PROFILE_COMPATIBILITY_RULES,
  modeRuleApplies,
  type CompatibilityRuleName,
} from './compatibility-rules.ts';

/** What rules read: the classified mode plus every cataloged option the file states. */
export interface CompatibilityProfileFacts extends CompatibilityOptions {
  readonly mode: WordCompatibilityMode;
  /** The mode's rule class. A refused declaration reads as `absent`. */
  readonly modeClass: CompatibilityModeClass;
}

/** The parsed compatibility profile of one settings part. */
export interface CompatibilityProfile extends CompatibilityProfileFacts {
  /** The value layout threads as `compatibilityMode`; `undefined` when absent or refused. */
  readonly modeValue: number | undefined;
  /** Whether a registered rule applies to this document. */
  has(rule: CompatibilityRuleName): boolean;
}

function isModeRule(rule: CompatibilityRuleName): rule is keyof typeof MODE_COMPATIBILITY_RULES {
  return Object.hasOwn(MODE_COMPATIBILITY_RULES, rule);
}

/** Parse a settings root (or `null` for a document without one) into its profile. */
export function compatibilityProfileFromSettings(root: OoxmlElement | null): CompatibilityProfile {
  const mode = readWordCompatibilityMode(root);
  const modeValue = compatibilityModeValue(mode);
  const modeClass = compatibilityModeClass(modeValue);
  const options = readCompatibilityOptions(root);
  const facts: CompatibilityProfileFacts = {
    mode,
    modeClass,
    legacy: options.legacy,
    settings: options.settings,
  };
  return Object.freeze({
    ...facts,
    modeValue,
    has(rule: CompatibilityRuleName): boolean {
      return isModeRule(rule)
        ? modeRuleApplies(rule, modeClass)
        : PROFILE_COMPATIBILITY_RULES[rule].applies(facts);
    },
  });
}
