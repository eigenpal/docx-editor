// The rule loop: when a node's text does not fit, its rules relax one value at a time, in
// order, until it does (`dgm:ruleLst`).
//
// Measured behaviour the loop follows:
// - A font rule steps the size down in whole points, to its `val` at the least.
// - A size rule grows `w` or `h` up to `fact` times the value its constraint refers to (or
//   to `val`), only as far as the text needs; when even the limit does not fit, it grows to
//   the limit and the next rule continues from there.
// - Growing the height cannot help a word wider than the line, so a height rule is skipped
//   then and a later font rule shrinks the text instead.
// - Values joined by an `equ` constraint move together: a font group shrinks to the size
//   its least fitting member needs, a height group grows to the tallest.

import type { DiagramTextMeasurer } from './diagram-layout-metrics.ts';
import {
  EMU_PER_MM,
  isFontType,
  matchesPointType,
  overrideKey,
  solveDiagramLayout,
  type LayoutSolution,
  type NodeState,
} from './diagram-layout-solve.ts';
import {
  hasVisibleText,
  nodeParagraphs,
  nodeTextFrame,
  textOwner,
  textFits,
  type DiagramParagraph,
} from './diagram-layout-text.ts';
import type { DiagramLayoutNode, DiagramLayoutTree, LayoutRule } from './diagram-layout-tree.ts';

/** Solves the rule loop may run for one diagram; past it the current sizes stand. */
export const MAX_RULE_SOLVES = 1024;
/** Bisection steps for a size rule. */
const SIZE_STEPS = 12;

interface RuleTarget {
  readonly node: DiagramLayoutNode;
  readonly rules: readonly LayoutRule[];
  readonly paragraphs: readonly DiagramParagraph[];
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

export interface RuleLoopOptions {
  readonly measurer: DiagramTextMeasurer;
  readonly fontFamily: string;
}

/**
 * Solve, then relax each text node's rules until its text fits. Returns the final solution,
 * or null when the layout itself is refused.
 */
export function solveWithRules(
  tree: DiagramLayoutTree,
  frame: Readonly<{ cx: number; cy: number }>,
  options: RuleLoopOptions
): LayoutSolution | null {
  const overrides = new Map<string, number>();
  let solves = 0;
  let solution = solveDiagramLayout(tree, frame, overrides);
  if (!solution) return null;
  const rulesByNode = new Map<number, LayoutRule[]>();
  for (const owner of tree.nodes) {
    for (const rule of owner.rules) {
      for (const target of ruleTargets(owner, rule)) {
        let list = rulesByNode.get(target.index);
        if (!list) rulesByNode.set(target.index, (list = []));
        list.push(rule);
      }
    }
  }
  const targets: RuleTarget[] = [];
  for (const node of tree.nodes) {
    const rules = rulesByNode.get(node.index);
    if (!rules) continue;
    const paragraphs = nodeParagraphs(tree.model, solution.states[node.index]!);
    if (!hasVisibleText(paragraphs)) continue;
    // Text whose every run sets its own size gains nothing from the rules.
    const sized = paragraphs.filter((paragraph) => paragraph.text.trim() !== '');
    if (sized.every((paragraph) => paragraph.explicitSize !== null)) continue;
    targets.push({ node, rules, paragraphs });
  }
  const groupOf = (index: number, type: string): readonly number[] => {
    for (const group of solution!.groups) {
      if (group.type === type && group.members.includes(index)) return group.members;
    }
    return [index];
  };
  const fit = (candidate: LayoutSolution, target: RuleTarget) => {
    const state = candidate.states[target.node.index]!;
    const rectangle = nodeTextFrame(state, textOwner(candidate, state));
    if (!rectangle) return { fits: true, wordsFit: true };
    return textFits(state, target.paragraphs, rectangle, options.measurer, options.fontFamily);
  };
  /** Solve with `type` of the target's group set to `value`; null past the budget. */
  const trial = (target: RuleTarget, type: string, value: number) => {
    if (solves >= MAX_RULE_SOLVES) return null;
    solves++;
    const next = new Map(overrides);
    for (const member of groupOf(target.node.index, type))
      next.set(overrideKey(member, type), value);
    const candidate = solveDiagramLayout(tree, frame, next);
    return candidate ? { candidate, next } : null;
  };
  const commit = (result: { candidate: LayoutSolution; next: Map<string, number> }) => {
    overrides.clear();
    for (const [key, value] of result.next) overrides.set(key, value);
    solution = result.candidate;
  };
  for (const target of targets) {
    for (const rule of target.rules) {
      const current = fit(solution, target);
      if (current.fits) break;
      const state: NodeState = solution.states[target.node.index]!;
      const value = state.values.get(rule.type);
      if (value === undefined) continue;
      if (isFontType(rule.type)) {
        const floor = Number.isFinite(rule.val) ? Math.max(1, Math.ceil(rule.val)) : 1;
        let high = Math.floor(value);
        if (high <= floor) continue;
        // Largest whole size in [floor, high) that fits; the floor when none does.
        let low = floor;
        let best = floor;
        high -= 1;
        while (low <= high) {
          const mid = Math.floor((low + high) / 2);
          const attempt = trial(target, rule.type, mid);
          if (!attempt) break;
          if (fit(attempt.candidate, target).fits) {
            best = mid;
            low = mid + 1;
          } else high = mid - 1;
        }
        const final = trial(target, rule.type, best);
        if (final) commit(final);
        continue;
      }
      if (rule.type !== 'w' && rule.type !== 'h') continue;
      // A size tied to another node's by an equality moves only with it.
      if (state.tied.has(rule.type)) continue;
      // A taller box cannot fit a word wider than the line.
      if (rule.type === 'h' && !current.wordsFit) continue;
      const base = state.bases.get(rule.type);
      let limit = Number.isFinite(rule.fact) && base !== undefined ? rule.fact * base : NaN;
      if (!Number.isFinite(limit)) {
        if (rule.val === Infinity) limit = value * 16;
        else if (Number.isFinite(rule.val)) limit = rule.val * EMU_PER_MM;
      }
      if (!Number.isFinite(limit) || limit <= value) continue;
      const atLimit = trial(target, rule.type, limit);
      if (!atLimit) break;
      if (!fit(atLimit.candidate, target).fits) {
        commit(atLimit);
        continue;
      }
      let low = value;
      let high = limit;
      for (let step = 0; step < SIZE_STEPS; step++) {
        const mid = (low + high) / 2;
        const attempt = trial(target, rule.type, mid);
        if (!attempt) break;
        if (fit(attempt.candidate, target).fits) high = mid;
        else low = mid;
      }
      const final = trial(target, rule.type, high);
      if (final) commit(final);
    }
  }
  return solution;
}
