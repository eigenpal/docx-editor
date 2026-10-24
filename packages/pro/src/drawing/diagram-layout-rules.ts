/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The rule loop: when a node's text does not fit, its rules relax one value at a time, in
// order, until it does (`dgm:ruleLst`).
//
// Measured behaviour the loop follows:
// - A font rule steps the size down in whole points, to its `val` at the least. It takes
//   the largest size at which the text fits and no line of the layout overflows its box.
//   A criterion the floor cannot meet either does not count: an overflow that does not
//   depend on the size, or text that outgrows a box sized in font units at every size.
// - A size rule grows `w` or `h` up to `fact` times the value its constraint refers to (or
//   to `val`), only as far as the text needs, in five halvings of the range; when even the
//   limit does not fit, it grows to the limit and the next rule continues from there. An
//   unbounded rule (`INF`) doubles the size until the text fits, then halves five times.
// - An unbounded size rule that follows a font rule (before the next one) grows the box for
//   every size the font rule tries, so that font shrinks only to make the layout fit.
// - Growing the height cannot help a word wider than the line, so a height rule is skipped
//   then and a later font rule shrinks the text instead.
// - Values joined by an `equ` constraint move together, and so do the nodes one rule names:
//   a font group shrinks to the size its least fitting member needs, a height group grows
//   to the tallest.
// - Custom text (`custT`) keeps its size and never shrinks its group.

import type { DiagramTextMeasurer } from './diagram-layout-metrics.ts';
import {
  CUSTOM_FONT_SIZE,
  EMU_PER_MM,
  isFontType,
  matchesPointType,
  overrideKey,
  solveDiagramLayout,
  type LayoutSolution,
} from './diagram-layout-solve.ts';
import {
  hasVisibleText,
  nodeParagraphs,
  nodeTextFrame,
  textOwner,
  textFits,
  type DiagramParagraph,
  type FitResult,
} from './diagram-layout-text.ts';
import type { DiagramLayoutNode, DiagramLayoutTree, LayoutRule } from './diagram-layout-tree.ts';

/** Solves the rule loop may run for one diagram; past it the current sizes stand. */
export const MAX_RULE_SOLVES = 1024;
/** Halvings a size rule narrows its growth by, once a size that fits is bracketed. */
const SIZE_STEPS = 5;
/** Doublings an unbounded size rule (`INF`) may grow a box by. */
const MAX_DOUBLINGS = 10;

interface RuleTarget {
  readonly node: DiagramLayoutNode;
  readonly rules: readonly LayoutRule[];
  readonly paragraphs: readonly DiagramParagraph[];
  /** Every run sets its own size. */
  readonly fixedText: boolean;
}

function ruleTargets(node: DiagramLayoutNode, rule: LayoutRule): DiagramLayoutNode[] {
  if (rule.for === 'self') return [node];
  const pool: DiagramLayoutNode[] = [];
  const collect = (current: DiagramLayoutNode, deep: boolean) => {
    for (const child of current.children) {
      pool.push(child);
      if (deep) collect(child, true);
    }
  };
  collect(node, rule.for === 'des');
  return pool.filter(
    (candidate) =>
      (rule.forName === null || candidate.name === rule.forName) &&
      matchesPointType(candidate.assocType, rule.ptType)
  );
}

/** Whether a node shows content marked as custom text (`custT`): its own or a child's. */
function showsCustomText(tree: DiagramLayoutTree, node: DiagramLayoutNode): boolean {
  const shown = tree.model.presOf.get(node.pres.modelId) ?? [];
  for (const id of [node.assoc, ...shown]) {
    const flag = tree.model.points
      .get(id)
      ?.prSet?.attributes.find((a) => a.localName === 'custT')?.value;
    if (flag === '1' || flag === 'true') return true;
  }
  return false;
}

export interface RuleLoopOptions {
  readonly measurer: DiagramTextMeasurer;
  readonly fontFamily: string;
}

/**
 * A solve after growth: `fixed` holds the overrides the rules have committed (font sizes,
 * custom text, grown boxes), `solution` adds the boxes grown for this solve alone.
 */
interface Settled {
  readonly solution: LayoutSolution;
  readonly fixed: ReadonlyMap<string, number>;
}

/** Overflow below this counts: a line that had to shrink by more than rounding. */
const OVERFLOW_TOLERANCE = 1e-6;

function isSizeRule(rule: LayoutRule): boolean {
  return rule.type === 'w' || rule.type === 'h';
}

function isUnbounded(rule: LayoutRule): boolean {
  return isSizeRule(rule) && rule.val === Infinity && !Number.isFinite(rule.fact);
}

/**
 * Solve, then relax each text node's rules in order until its text fits. Returns the final
 * solution, or null when the layout itself is refused.
 *
 * - A size rule (`w`, `h`) grows the box at the current font size and keeps it.
 * - A font rule takes the largest whole size, down to its floor, at which the text fits and
 *   no line of the layout overflows its box (unless even the floor overflows: then only the
 *   text counts). An unbounded size rule after it, before the next font rule, grows the box
 *   for each size tried, so such a font shrinks only when the layout overflows.
 * - Text nodes without a font rule grow their unbounded boxes at every size tried, so the
 *   layout check sees them as they will be.
 */
export function solveWithRules(
  tree: DiagramLayoutTree,
  frame: Readonly<{ cx: number; cy: number }>,
  options: RuleLoopOptions
): LayoutSolution | null {
  let solves = 0;
  const solve = (overrides: ReadonlyMap<string, number>): LayoutSolution | null => {
    if (solves >= MAX_RULE_SOLVES) return null;
    solves++;
    return solveDiagramLayout(tree, frame, overrides);
  };
  const first = solve(new Map());
  if (!first) return null;
  const rulesByNode = new Map<number, LayoutRule[]>();
  // The nodes one rule applies to: a font rule shrinks them together.
  const peers = new Map<LayoutRule, readonly number[]>();
  for (const owner of tree.nodes) {
    for (const rule of owner.rules) {
      const applies = ruleTargets(owner, rule);
      peers.set(
        rule,
        applies.map((node) => node.index)
      );
      for (const target of applies) {
        let list = rulesByNode.get(target.index);
        if (!list) rulesByNode.set(target.index, (list = []));
        list.push(rule);
      }
    }
  }
  // Content marked as custom text (`custT`) keeps its own size, and the node's text values
  // (margins that refer to the size) follow it.
  const fonts = new Map<string, number>();
  const custom = new Set<number>();
  for (const node of tree.nodes) {
    if (!showsCustomText(tree, node)) continue;
    let size = 0;
    for (const paragraph of nodeParagraphs(tree.model, first.states[node.index]!)) {
      size = Math.max(size, paragraph.explicitSize ?? 0);
    }
    if (!(size > 0)) continue;
    fonts.set(overrideKey(node.index, CUSTOM_FONT_SIZE), size);
    custom.add(node.index);
  }
  const targets: RuleTarget[] = [];
  for (const node of tree.nodes) {
    const rules = rulesByNode.get(node.index);
    if (!rules) continue;
    const paragraphs = nodeParagraphs(tree.model, first.states[node.index]!);
    if (!hasVisibleText(paragraphs)) continue;
    // Text whose every run sets its own size gains nothing from a font rule; its box still
    // grows to hold it.
    const sized = paragraphs.filter((paragraph) => paragraph.text.trim() !== '');
    const fixedText = sized.every((paragraph) => paragraph.explicitSize !== null);
    targets.push({ node, rules, paragraphs, fixedText });
  }
  const shrinks = (target: RuleTarget) =>
    !custom.has(target.node.index) &&
    !target.fixedText &&
    target.rules.some((r) => isFontType(r.type));
  const groupOf = (solution: LayoutSolution, index: number, type: string) => {
    for (const group of solution.groups) {
      if (group.type === type && group.members.includes(index)) return group.members;
    }
    return [index];
  };
  /** Whether the target's text fits, with its own box sizes changed as `sizes` says. */
  const fit = (
    solution: LayoutSolution,
    target: RuleTarget,
    sizes?: ReadonlyMap<string, number>
  ): FitResult => {
    const solved = solution.states[target.node.index]!;
    const owner = textOwner(solution, solved);
    let state = solved;
    if (sizes && sizes.size > 0 && owner === solved && solved.box) {
      const box = { ...solved.box };
      const values = new Map(solved.values);
      for (const [type, value] of sizes) {
        if (type === 'w') box.w = value;
        else box.h = value;
        values.set(type, value);
      }
      state = { ...solved, box, values };
    }
    const rectangle = nodeTextFrame(state, owner === solved ? state : owner);
    if (!rectangle) return { fits: true, wordsFit: true };
    return textFits(state, target.paragraphs, rectangle, options.measurer, options.fontFamily);
  };
  /** How far a size rule grows a box for its text, or null when it does not apply. */
  const grow = (
    solution: LayoutSolution,
    target: RuleTarget,
    rule: LayoutRule,
    sizes: ReadonlyMap<string, number>
  ): number | null => {
    const state = solution.states[target.node.index]!;
    if (textOwner(solution, state) !== state || !state.box) return null;
    const type = rule.type;
    // A size tied to another node's by an equality moves only with it.
    if (state.tied.has(type)) return null;
    const value = sizes.get(type) ?? (type === 'w' ? state.box.w : state.box.h);
    if (!(value > 0)) return null;
    const fitsAt = (candidate: number) =>
      fit(solution, target, new Map(sizes).set(type, candidate)).fits;
    let low = value;
    let high: number;
    if (isUnbounded(rule)) {
      // Unbounded: double until the text fits, then narrow down.
      high = value * 2;
      for (let doubling = 1; !fitsAt(high); doubling++) {
        if (doubling >= MAX_DOUBLINGS) return high;
        low = high;
        high *= 2;
      }
    } else {
      const base = state.bases.get(type);
      let limit = Number.isFinite(rule.fact) && base !== undefined ? rule.fact * base : NaN;
      if (!Number.isFinite(limit) && Number.isFinite(rule.val)) limit = rule.val * EMU_PER_MM;
      if (!Number.isFinite(limit) || limit <= value) return null;
      // When even the limit does not fit, the box takes the limit and the next rule goes on.
      if (!fitsAt(limit)) return limit;
      high = limit;
    }
    for (let step = 0; step < SIZE_STEPS; step++) {
      const mid = (low + high) / 2;
      if (fitsAt(mid)) high = mid;
      else low = mid;
    }
    return high;
  };
  /** Grow a target's box by `rules` in order until its text fits; the sizes it took. */
  const growAll = (solution: LayoutSolution, target: RuleTarget, rules: readonly LayoutRule[]) => {
    const sizes = new Map<string, number>();
    let current = fit(solution, target);
    for (const rule of rules) {
      if (current.fits) break;
      // A taller box cannot fit a word wider than the line.
      if (rule.type === 'h' && !current.wordsFit) continue;
      const value = grow(solution, target, rule, sizes);
      if (value === null) continue;
      sizes.set(rule.type, value);
      current = fit(solution, target, sizes);
    }
    return sizes;
  };
  /** Sizes into overrides; a group joined by an equality takes its largest member. */
  const record = (
    solution: LayoutSolution,
    target: RuleTarget,
    sizes: ReadonlyMap<string, number>,
    overrides: Map<string, number>,
    unbounded: boolean
  ) => {
    const state = solution.states[target.node.index]!;
    for (const [type, grown] of sizes) {
      // An unbounded box its line scaled down grows its solved size by as much more.
      const value = unbounded ? grown / (state.flowScale.get(type) ?? 1) : grown;
      for (const member of groupOf(solution, target.node.index, type)) {
        const key = overrideKey(member, type);
        overrides.set(key, Math.max(overrides.get(key) ?? 0, value));
      }
    }
  };
  /**
   * Solve with these overrides, then grow the unbounded boxes of text nodes that have no
   * font rule, and of `lookahead` nodes, for their text.
   */
  const settle = (
    overrides: ReadonlyMap<string, number>,
    lookahead: ReadonlySet<number>
  ): Settled | null => {
    const solution = solve(overrides);
    if (!solution) return null;
    const next = new Map(overrides);
    let grown = false;
    for (const target of targets) {
      if (shrinks(target) && !lookahead.has(target.node.index)) continue;
      const sizes = growAll(solution, target, target.rules.filter(isUnbounded));
      if (sizes.size === 0) continue;
      record(solution, target, sizes, next, true);
      grown = true;
    }
    if (!grown) return { solution, fixed: overrides };
    const regrown = solve(next);
    return regrown ? { solution: regrown, fixed: overrides } : null;
  };
  const none = new Set<number>();
  let current = settle(fonts, none);
  if (!current) return null;
  const layoutFits = (solution: LayoutSolution) => solution.overflow >= 1 - OVERFLOW_TOLERANCE;
  const applied = new Set<LayoutRule>();
  for (const target of targets) {
    target.rules.forEach((rule, index) => {
      if (!current) return;
      const now = fit(current.solution, target);
      if (isSizeRule(rule)) {
        if (now.fits) return;
        if (rule.type === 'h' && !now.wordsFit) return;
        const value = grow(current.solution, target, rule, new Map());
        if (value === null) return;
        const next = new Map(current.fixed);
        record(current.solution, target, new Map([[rule.type, value]]), next, isUnbounded(rule));
        current = settle(next, none) ?? current;
        return;
      }
      if (!isFontType(rule.type) || !shrinks(target) || applied.has(rule)) return;
      // A font rule applies once, to every text node it names and every node whose size
      // an equality joins to theirs.
      const solved = current.solution;
      const members = new Set<number>();
      for (const peer of peers.get(rule) ?? [target.node.index]) {
        for (const member of groupOf(solved, peer, rule.type)) members.add(member);
      }
      const texts = targets.filter((t) => members.has(t.node.index) && shrinks(t));
      if (texts.every((t) => fit(solved, t).fits) && layoutFits(solved)) return;
      applied.add(rule);
      const value = current.solution.states[target.node.index]!.values.get(rule.type);
      if (value === undefined) return;
      const floor = Number.isFinite(rule.val) ? Math.max(1, Math.ceil(rule.val)) : 1;
      if (Math.floor(value) <= floor) return;
      // An unbounded size rule before the next font rule grows the box for every size.
      let unbounded = false;
      for (const later of target.rules.slice(index + 1)) {
        if (isFontType(later.type)) break;
        if (isUnbounded(later)) unbounded = true;
      }
      const lookahead = unbounded ? members : none;
      const base = current.fixed;
      const atSize = (size: number) => {
        const next = new Map(base);
        for (const member of members) {
          if (!custom.has(member)) next.set(overrideKey(member, rule.type), size);
        }
        return settle(next, lookahead);
      };
      const lowest = atSize(floor);
      if (!lowest) return;
      // A criterion counts only when the size decides it: an overflow the floor clears, and
      // text that fits at the floor (a box sized in font units may outgrow it at any size).
      const layoutMatters = layoutFits(lowest.solution) && !layoutFits(current.solution);
      const fitting = texts.filter((t) => fit(lowest.solution, t).fits);
      if (!layoutMatters && fitting.length === 0) {
        current = lowest;
        return;
      }
      const fitsAt = (settled: Settled) =>
        fitting.every((t) => fit(settled.solution, t).fits) &&
        (!layoutMatters || layoutFits(settled.solution));
      // Largest whole size in [floor, value] that fits; the floor when none does.
      let best = lowest;
      let low = floor + 1;
      let high = Math.floor(value);
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const attempt = atSize(mid);
        if (!attempt) break;
        if (fitsAt(attempt)) {
          best = attempt;
          low = mid + 1;
        } else high = mid - 1;
      }
      current = best;
    });
  }
  return current.solution;
}
