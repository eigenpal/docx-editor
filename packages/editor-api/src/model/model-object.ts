/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// What every object in this model does the same way.
//
// The runtime's `ClientObject` decides the LIFETIME rules — when a call is refused, what a released
// object answers, where loaded values live. This adds the three things that are the same for every
// document object above it: reading text into a loaded property, queueing a command whose only
// answer is that the batch committed, and queueing a command that DOES answer something (the range
// an insertion occupies, the paragraph it created) so the caller has an object to carry on with.
//
// It imports no other model class ON PURPOSE. `Body`, `Paragraph`, `Range` and the collections all
// reference each other, and every one of them extends this — so a single import from here into any
// of them would make the base class's own evaluation depend on a class that is still being defined.
// The helpers take a settle callback instead, and each class builds its own objects.

import {
  ClientObject,
  hydratedApplied,
  hydratedText,
  internalsOf,
  selectedProperties,
  type AutomationOperation,
  type AutomationValue,
  type ResolvedLoadOptions,
} from '../runtime/model-support.ts';

export abstract class ModelObject extends ClientObject {
  /** Runtime-wide revision view behind standard Office-compatible text reads and searches. */
  protected revisionTextView(): 'allMarkup' | 'original' {
    return internalsOf(this.context).revisionTextView;
  }

  /** Queue a read whose text answer becomes the loaded property `name`. */
  protected loadTextInto(name: string, plan: () => AutomationOperation): void {
    const label = `${this.path.label}.${name}`;
    this.enqueue({
      sort: 'read',
      label,
      plan,
      settle: (value) => {
        this.setLoadedProperty(name, hydratedText(value, label));
      },
    });
  }

  /** Queue a command with nothing to answer. Nothing is written until `sync()`. */
  protected command(name: string, plan: () => AutomationOperation): void {
    const label = `${this.path.label}.${name}`;
    this.enqueue({ sort: 'write', label, plan, settle: (value) => hydratedApplied(value, label) });
  }

  /**
   * Queue a command whose answer this call has no use for.
   *
   * `clear()` is the case: the operation behind it is a replacement, and a replacement answers the
   * range it wrote — a range over no text, here. The answer is dropped rather than checked for a
   * shape the method does not return, so that the operation stays the same one an insertion uses.
   */
  protected commandDiscarding(name: string, plan: () => AutomationOperation): void {
    const label = `${this.path.label}.${name}`;
    this.enqueue({ sort: 'write', label, plan, settle: () => {} });
  }

  /** Queue a command whose answer names something the caller keeps. */
  protected commandAnswering(
    label: string,
    plan: () => AutomationOperation,
    settle: (value: AutomationValue) => void
  ): void {
    this.enqueue({ sort: 'write', label, plan, settle });
  }

  /** Queue a read whose answer is hydrated by the caller. */
  protected read(
    label: string,
    plan: () => AutomationOperation,
    settle: (value: AutomationValue) => void
  ): void {
    this.enqueue({ sort: 'read', label, plan, settle });
  }

  /** The properties a load asked for, refusing any name this object does not have. */
  protected selection(
    request: ResolvedLoadOptions,
    available: readonly string[]
  ): readonly string[] {
    return selectedProperties(request, available, this.path.label);
  }

  /** @internal Plan the read this object's `load(...)` asked for. */
  protected onLoad(request: ResolvedLoadOptions): void {
    this.selection(request, []);
  }
}
