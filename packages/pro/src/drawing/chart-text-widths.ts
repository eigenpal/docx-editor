/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Advance-width estimates for chart text, used only to size the automatic chart layout.
//
// Each table holds the advances of U+0020..U+007E, in thousandths of an em, of a metric
// compatible stand-in for a common chart face. Other scripts take a per-script average.

/** Calibri metrics (Carlito). */
const CALIBRI = [
  226, 326, 401, 498, 507, 715, 682, 221, 303, 303, 498, 498, 250, 306, 252, 386, 507, 507, 507,
  507, 507, 507, 507, 507, 507, 507, 268, 268, 498, 498, 498, 463, 894, 579, 544, 533, 615, 488,
  459, 631, 623, 252, 319, 520, 420, 855, 646, 662, 517, 673, 543, 459, 487, 642, 567, 890, 519,
  487, 468, 307, 386, 307, 498, 498, 291, 479, 525, 423, 525, 498, 305, 471, 525, 229, 239, 455,
  229, 799, 525, 527, 525, 525, 349, 391, 335, 525, 452, 715, 433, 453, 395, 314, 460, 314, 498,
];
const CALIBRI_BOLD = [
  226, 326, 438, 498, 507, 729, 705, 233, 312, 312, 498, 498, 258, 306, 267, 430, 507, 507, 507,
  507, 507, 507, 507, 507, 507, 507, 276, 276, 498, 498, 498, 463, 898, 606, 561, 529, 630, 488,
  459, 637, 631, 267, 331, 547, 423, 874, 659, 676, 532, 686, 563, 473, 495, 653, 591, 906, 551,
  520, 478, 325, 430, 325, 498, 498, 300, 494, 537, 418, 537, 503, 316, 474, 537, 246, 255, 480,
  246, 813, 537, 538, 537, 537, 355, 399, 347, 537, 473, 745, 459, 474, 397, 344, 475, 344, 498,
];
/** Arial metrics (Liberation Sans). */
const ARIAL = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
const ARIAL_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667,
  611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556,
  278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
/** Times New Roman metrics (Liberation Serif). */
const TIMES = [
  250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, 500, 500, 500,
  500, 500, 500, 500, 500, 500, 500, 278, 278, 564, 564, 564, 444, 921, 722, 667, 667, 722, 611,
  556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556, 611, 722, 722, 944, 722,
  722, 611, 333, 278, 333, 469, 500, 333, 444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500,
  278, 778, 500, 500, 500, 500, 333, 389, 278, 500, 500, 722, 500, 500, 444, 480, 200, 480, 541,
];

/** The advance table for a face: theme tokens and Calibri-like faces use Calibri metrics. */
function tableFor(face: string, bold: boolean): readonly number[] {
  const name = face.toLowerCase();
  if (/times|serif|tinos|georgia|cambria|garamond|book/.test(name)) return TIMES;
  if (name.startsWith('+') || /calibri|carlito|aptos/.test(name)) {
    return bold ? CALIBRI_BOLD : CALIBRI;
  }
  return bold ? ARIAL_BOLD : ARIAL;
}

/** Average advance of a character outside the tables, by script. */
function scriptAdvance(code: number): number {
  if (code >= 0x0590 && code <= 0x05ff) return 500;
  if (code >= 0x0600 && code <= 0x06ff) return 450;
  if (code >= 0x2e80) return 1000;
  return 580;
}

/** Estimated advance of `code`, in thousandths of an em of `face`. */
export function estimatedAdvance(code: number, face: string, bold: boolean): number {
  if (code >= 0x20 && code <= 0x7e) return tableFor(face, bold)[code - 0x20]!;
  return scriptAdvance(code);
}
