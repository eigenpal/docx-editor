#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Render two PDFs and create deterministic pixel-difference artifacts."""

from __future__ import annotations

import argparse
import difflib
import json
import math
import re
import shutil
import statistics
import subprocess
import sys
import tempfile
import unicodedata
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

from PIL import __version__ as pillow_version
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageOps, ImageStat

DEFAULT_THRESHOLDS = (0, 8, 16, 28, 64)
MARKER = ".pdf-visual-diff"


def command_path(name: str) -> str:
    path = shutil.which(name)
    if path is None:
        raise RuntimeError(f"Required command is not installed: {name}")
    return path


def run(
    command: list[str],
    timeout_seconds: int = 120,
    merge_stderr: bool = True,
) -> str:
    return subprocess.check_output(
        command,
        stderr=subprocess.STDOUT if merge_stderr else subprocess.PIPE,
        text=True,
        timeout=timeout_seconds,
    )


def document_info(pdf: Path, max_pages: int, timeout_seconds: int) -> dict[str, Any]:
    tool = command_path("pdfinfo")
    summary = run([tool, str(pdf)], timeout_seconds)
    page_match = re.search(r"^Pages:\s+(\d+)", summary, re.MULTILINE)
    if page_match is None:
        raise RuntimeError(f"pdfinfo did not report a page count for {pdf}")
    pages = int(page_match.group(1))
    if pages > max_pages:
        raise RuntimeError(f"{pdf} has {pages} pages, above --max-pages {max_pages}")

    details = run([tool, "-f", "1", "-l", str(pages), str(pdf)], timeout_seconds)
    sizes: dict[int, tuple[float, float]] = {}
    for match in re.finditer(
        r"^Page\s+(\d+)\s+size:\s+([0-9.]+)\s+x\s+([0-9.]+)\s+pts",
        details,
        re.MULTILINE,
    ):
        sizes[int(match.group(1))] = (float(match.group(2)), float(match.group(3)))
    if len(sizes) != pages:
        raise RuntimeError(f"pdfinfo did not report every page size for {pdf}")
    return {"pages": pages, "sizesPt": [sizes[page] for page in range(1, pages + 1)]}


def render_size(size_pt: tuple[float, float], dpi: int) -> tuple[int, int]:
    return (
        math.ceil(size_pt[0] * dpi / 72),
        math.ceil(size_pt[1] * dpi / 72),
    )


def validate_render_budget(
    reference: dict[str, Any],
    candidate: dict[str, Any],
    dpi: int,
    max_pixels: int,
    max_total_pixels: int,
) -> int:
    pages = max(reference["pages"], candidate["pages"])
    total = 0
    for index in range(pages):
        reference_size = (
            render_size(reference["sizesPt"][index], dpi)
            if index < reference["pages"]
            else (0, 0)
        )
        candidate_size = (
            render_size(candidate["sizesPt"][index], dpi)
            if index < candidate["pages"]
            else (0, 0)
        )
        width = max(reference_size[0], candidate_size[0])
        height = max(reference_size[1], candidate_size[1])
        pixels = width * height
        if pixels > max_pixels:
            raise RuntimeError(
                f"Page {index + 1} needs {pixels} pixels, above --max-pixels {max_pixels}"
            )
        total += pixels
        if total > max_total_pixels:
            raise RuntimeError(
                f"Comparison needs {total} pixels, above --max-total-pixels "
                f"{max_total_pixels}"
            )
    return total


def normalized_word(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).split())


def extract_words(
    pdf: Path,
    max_words: int,
    max_words_per_page: int,
    max_bbox_bytes: int,
    timeout_seconds: int,
    backend: str = "poppler",
) -> list[dict[str, Any]]:
    if backend == "mupdf":
        import pymupdf
        words = []
        with pymupdf.open(pdf) as document:
            for index, page in enumerate(document, start=1):
                # Read physical glyph positions instead of line-level ActualText boxes.
                extracted = page.get_text("words", flags=pymupdf.TEXTFLAGS_WORDS | pymupdf.TEXT_IGNORE_ACTUALTEXT)
                if len(extracted) > max_words_per_page or len(words) + len(extracted) > max_words:
                    raise RuntimeError(f"{pdf} exceeds the word extraction budget")
                for x0, y0, x1, y1, text, *_ in extracted:
                    words.append(dict(text=normalized_word(text), page=index, x0=x0, y0=y0, x1=x1, y1=y1))
        if len(json.dumps(words).encode()) > max_bbox_bytes:
            raise RuntimeError(f"{pdf} exceeds --max-bbox-bytes")
        return words
    xml = run(
        [
            command_path("pdftotext"),
            "-bbox",
            "-enc",
            "UTF-8",
            str(pdf),
            "-",
        ],
        timeout_seconds,
        merge_stderr=False,
    )
    if len(xml.encode("utf-8")) > max_bbox_bytes:
        raise RuntimeError(f"{pdf} bbox output exceeds --max-bbox-bytes {max_bbox_bytes}")
    root = ET.fromstring(xml)
    words: list[dict[str, Any]] = []
    pages = [element for element in root.iter() if element.tag.rsplit("}", 1)[-1] == "page"]
    for page_index, page in enumerate(pages, start=1):
        page_words = 0
        for element in page.iter():
            if element.tag.rsplit("}", 1)[-1] != "word":
                continue
            text = normalized_word(element.text or "")
            if not text:
                continue
            words.append(
                {
                    "text": text,
                    "page": page_index,
                    "x0": float(element.attrib["xMin"]),
                    "y0": float(element.attrib["yMin"]),
                    "x1": float(element.attrib["xMax"]),
                    "y1": float(element.attrib["yMax"]),
                }
            )
            page_words += 1
            if page_words > max_words_per_page:
                raise RuntimeError(
                    f"{pdf} page {page_index} has more than --max-words-per-page "
                    f"{max_words_per_page}"
                )
            if len(words) > max_words:
                raise RuntimeError(f"{pdf} has more than --max-words {max_words}")
    return words


def word_matches(
    reference: list[dict[str, Any]],
    candidate: list[dict[str, Any]],
) -> list[tuple[int, int]]:
    def monotonic_geometry_pairs(
        left_words: list[dict[str, Any]],
        left_indices: list[int],
        right_words: list[dict[str, Any]],
        right_indices: list[int],
    ) -> list[tuple[int, int]]:
        if len(left_indices) > len(right_indices):
            return [
                (right_index, left_index)
                for left_index, right_index in monotonic_geometry_pairs(
                    right_words,
                    right_indices,
                    left_words,
                    left_indices,
                )
            ]
        if len(left_indices) * len(right_indices) > 100_000:
            return list(zip(left_indices, right_indices))
        rows = len(left_indices)
        columns = len(right_indices)
        costs = [[math.inf] * (columns + 1) for _ in range(rows + 1)]
        matched = [[False] * (columns + 1) for _ in range(rows + 1)]
        for column in range(columns + 1):
            costs[0][column] = 0
        for row in range(1, rows + 1):
            left = left_words[left_indices[row - 1]]
            left_x = (left["x0"] + left["x1"]) / 2
            left_y = (left["y0"] + left["y1"]) / 2
            for column in range(1, columns + 1):
                skip_cost = costs[row][column - 1]
                right = right_words[right_indices[column - 1]]
                right_x = (right["x0"] + right["x1"]) / 2
                right_y = (right["y0"] + right["y1"]) / 2
                pair_cost = costs[row - 1][column - 1] + math.hypot(
                    right_x - left_x,
                    right_y - left_y,
                )
                if pair_cost < skip_cost:
                    costs[row][column] = pair_cost
                    matched[row][column] = True
                else:
                    costs[row][column] = skip_cost
        pairs: list[tuple[int, int]] = []
        row = rows
        column = columns
        while row > 0 and column > 0:
            if matched[row][column]:
                pairs.append((left_indices[row - 1], right_indices[column - 1]))
                row -= 1
                column -= 1
            else:
                column -= 1
        pairs.reverse()
        return pairs

    matches: list[tuple[int, int]] = []
    matched_reference: set[int] = set()
    matched_candidate: set[int] = set()
    pages = sorted({word["page"] for word in reference} | {word["page"] for word in candidate})

    for page in pages:
        reference_indices = [
            index for index, word in enumerate(reference) if word["page"] == page
        ]
        candidate_indices = [
            index for index, word in enumerate(candidate) if word["page"] == page
        ]
        matcher = difflib.SequenceMatcher(
            None,
            [reference[index]["text"] for index in reference_indices],
            [candidate[index]["text"] for index in candidate_indices],
            autojunk=False,
        )
        for block in matcher.get_matching_blocks():
            for offset in range(block.size):
                reference_index = reference_indices[block.a + offset]
                candidate_index = candidate_indices[block.b + offset]
                matches.append((reference_index, candidate_index))
                matched_reference.add(reference_index)
                matched_candidate.add(candidate_index)

    def pair_residuals(same_page: bool) -> None:
        reference_groups: dict[tuple[Any, ...], list[int]] = {}
        candidate_groups: dict[tuple[Any, ...], list[int]] = {}
        for index, word in enumerate(reference):
            if index in matched_reference:
                continue
            key = (word["page"], word["text"]) if same_page else (word["text"],)
            reference_groups.setdefault(key, []).append(index)
        for index, word in enumerate(candidate):
            if index in matched_candidate:
                continue
            key = (word["page"], word["text"]) if same_page else (word["text"],)
            candidate_groups.setdefault(key, []).append(index)
        for key in sorted(reference_groups.keys() & candidate_groups.keys()):
            reference_indices = sorted(
                reference_groups[key],
                key=lambda index: (
                    reference[index]["page"],
                    reference[index]["y0"],
                    reference[index]["x0"],
                    index,
                ),
            )
            candidate_indices = sorted(
                candidate_groups[key],
                key=lambda index: (
                    candidate[index]["page"],
                    candidate[index]["y0"],
                    candidate[index]["x0"],
                    index,
                ),
            )
            for reference_index, candidate_index in zip(reference_indices, candidate_indices):
                matches.append((reference_index, candidate_index))
                matched_reference.add(reference_index)
                matched_candidate.add(candidate_index)

    pair_residuals(True)
    pair_residuals(False)

    # Sequence alignment can pair repeated labels across distant table rows when nearby
    # text wraps differently. Equal same-page inventories retain reading-order identity.
    repeated_reference: dict[tuple[int, str], list[int]] = {}
    repeated_candidate: dict[tuple[int, str], list[int]] = {}
    for index, word in enumerate(reference):
        repeated_reference.setdefault((word["page"], word["text"]), []).append(index)
    for index, word in enumerate(candidate):
        repeated_candidate.setdefault((word["page"], word["text"]), []).append(index)
    for key in repeated_reference.keys() & repeated_candidate.keys():
        reference_indices = repeated_reference[key]
        candidate_indices = repeated_candidate[key]
        if len(reference_indices) < 2 or len(candidate_indices) < 2:
            continue
        reference_set = set(reference_indices)
        candidate_set = set(candidate_indices)
        matches = [
            pair
            for pair in matches
            if pair[0] not in reference_set and pair[1] not in candidate_set
        ]
        reading_order = lambda words, index: (
            words[index]["y0"],
            words[index]["x0"],
            index,
        )
        ordered_reference = sorted(
            reference_indices,
            key=lambda index: reading_order(reference, index),
        )
        ordered_candidate = sorted(
            candidate_indices,
            key=lambda index: reading_order(candidate, index),
        )
        for reference_index, candidate_index in monotonic_geometry_pairs(
            reference,
            ordered_reference,
            candidate,
            ordered_candidate,
        ):
            matches.append((reference_index, candidate_index))

    matches.sort()
    return matches


def compare_word_movement(
    reference: list[dict[str, Any]],
    candidate: list[dict[str, Any]],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    matched_indices = word_matches(reference, candidate)
    matched_reference = {pair[0] for pair in matched_indices}
    matched_candidate = {pair[1] for pair in matched_indices}
    buckets = {
        "within0_5Pt": 0,
        "between0_5And2Pt": 0,
        "between2And8Pt": 0,
        "beyond8Pt": 0,
        "crossPage": 0,
    }
    distances: list[float] = []
    pairs: list[dict[str, Any]] = []
    weighted_penalty = 0.0
    for reference_index, candidate_index in matched_indices:
        reference_word = reference[reference_index]
        candidate_word = candidate[candidate_index]
        if reference_word["page"] != candidate_word["page"]:
            buckets["crossPage"] += 1
            weighted_penalty += 100
            distance = None
        else:
            distance = math.hypot(
                (candidate_word["x0"] + candidate_word["x1"]) / 2
                - (reference_word["x0"] + reference_word["x1"]) / 2,
                (candidate_word["y0"] + candidate_word["y1"]) / 2
                - (reference_word["y0"] + reference_word["y1"]) / 2,
            )
            distances.append(distance)
            if distance <= 0.5:
                buckets["within0_5Pt"] += 1
            elif distance <= 2:
                buckets["between0_5And2Pt"] += 1
            elif distance <= 8:
                buckets["between2And8Pt"] += 1
            else:
                buckets["beyond8Pt"] += 1
            weighted_penalty += min(100, distance * 5)
        pairs.append(
            {
                "text": reference_word["text"],
                "reference": reference_word,
                "candidate": candidate_word,
                "distancePt": round(distance, 4) if distance is not None else None,
            }
        )

    unmatched_reference = len(reference) - len(matched_reference)
    unmatched_candidate = len(candidate) - len(matched_candidate)
    if buckets["crossPage"]:
        severity = "critical"
    elif buckets["beyond8Pt"]:
        severity = "major"
    elif buckets["between2And8Pt"]:
        severity = "moderate"
    elif buckets["between0_5And2Pt"]:
        severity = "minor"
    else:
        severity = "equal"
    sorted_distances = sorted(distances)
    denominator = max(1, len(matched_indices) * 2)
    largest_movements = sorted(
        (
            {
                "text": pair["text"],
                "referencePage": pair["reference"]["page"],
                "candidatePage": pair["candidate"]["page"],
                "referenceXPt": round(pair["reference"]["x0"], 3),
                "referenceYPt": round(pair["reference"]["y0"], 3),
                "candidateXPt": round(pair["candidate"]["x0"], 3),
                "candidateYPt": round(pair["candidate"]["y0"], 3),
                "distancePt": pair["distancePt"],
            }
            for pair in pairs
            if pair["distancePt"] is None or pair["distancePt"] > 0.5
        ),
        key=lambda movement: (
            movement["distancePt"] is None,
            movement["distancePt"] or 0,
        ),
        reverse=True,
    )[:100]
    reading_order = sorted(pairs, key=lambda pair: (
        pair['reference']['page'], pair['reference']['y0'], pair['reference']['x0']))
    earliest_movements = [
        dict(text=pair['text'], referencePage=pair['reference']['page'],
             candidatePage=pair['candidate']['page'], referenceYPt=round(pair['reference']['y0'], 3),
             candidateYPt=round(pair['candidate']['y0'], 3), distancePt=pair['distancePt'])
        for pair in reading_order if pair['distancePt'] is None or pair['distancePt'] > 0.5
    ][:100]
    page_drift = []
    for page in sorted({pair['reference']['page'] for pair in reading_order}):
        same_page = [pair for pair in reading_order
                     if pair['reference']['page'] == page == pair['candidate']['page']]
        if not same_page:
            continue
        deltas = [((pair['candidate']['y0'] + pair['candidate']['y1'])
                   - (pair['reference']['y0'] + pair['reference']['y1'])) / 2 for pair in same_page]
        band = max(1, len(deltas) // 3)
        page_drift.append(dict(page=page, matchedTokens=len(deltas),
                               medianDeltaYPt=round(statistics.median(deltas), 4),
                               topThirdDeltaYPt=round(statistics.median(deltas[:band]), 4),
                               bottomThirdDeltaYPt=round(statistics.median(deltas[-band:]), 4)))
    summary = {
        "severity": severity,
        "referenceWords": len(reference),
        "candidateWords": len(candidate),
        "matchedWords": len(matched_indices),
        "unmatchedReferenceWords": unmatched_reference,
        "unmatchedCandidateWords": unmatched_candidate,
        "missingWordCount": unmatched_reference,
        "extraWordCount": unmatched_candidate,
        "distanceBuckets": buckets,
        "maxDistancePt": round(max(distances), 4) if distances else None,
        "medianDistancePt": (
            round(sorted_distances[len(sorted_distances) // 2], 4)
            if sorted_distances
            else None
        ),
        "movementScore": round(min(100, weighted_penalty / denominator), 4),
        "largestMovements": largest_movements,
        "earliestMovements": earliest_movements,
        "pageDrift": page_drift,
        "unmatchedReferenceSample": [
            reference[index]["text"]
            for index in range(len(reference))
            if index not in matched_reference
        ][:50],
        "unmatchedCandidateSample": [
            candidate[index]["text"]
            for index in range(len(candidate))
            if index not in matched_candidate
        ][:50],
    }
    return summary, pairs


def scaled_box(word: dict[str, Any], dpi: int) -> tuple[int, int, int, int]:
    scale = dpi / 72
    return tuple(round(word[key] * scale) for key in ("x0", "y0", "x1", "y1"))


def save_movement_overlays(
    pairs: list[dict[str, Any]],
    output: Path,
    dpi: int,
    pages: int,
) -> None:
    images: dict[int, Image.Image] = {}
    draws: dict[int, ImageDraw.ImageDraw] = {}

    def drawing(page: int) -> ImageDraw.ImageDraw:
        if page not in draws:
            path = output / "pages" / f"page-{page:04d}" / "candidate.png"
            images[page] = load_rgb(path)
            draws[page] = ImageDraw.Draw(images[page])
        return draws[page]

    for pair in pairs:
        reference = pair["reference"]
        candidate = pair["candidate"]
        distance = pair["distancePt"]
        if reference["page"] != candidate["page"]:
            reference_draw = drawing(reference["page"])
            candidate_draw = drawing(candidate["page"])
            reference_draw.rectangle(scaled_box(reference, dpi), outline=(255, 0, 0), width=2)
            candidate_draw.rectangle(scaled_box(candidate, dpi), outline=(0, 96, 255), width=2)
            continue
        if distance is None or distance <= 2:
            continue
        page_draw = drawing(reference["page"])
        reference_box = scaled_box(reference, dpi)
        candidate_box = scaled_box(candidate, dpi)
        color = (255, 0, 0) if distance > 8 else (255, 144, 0)
        page_draw.rectangle(reference_box, outline=color, width=2)
        page_draw.rectangle(candidate_box, outline=(0, 96, 255), width=2)
        page_draw.line(
            (
                (reference_box[0] + reference_box[2]) // 2,
                (reference_box[1] + reference_box[3]) // 2,
                (candidate_box[0] + candidate_box[2]) // 2,
                (candidate_box[1] + candidate_box[3]) // 2,
            ),
            fill=color,
            width=2,
        )

    for page in range(1, pages + 1):
        if page not in images:
            source = output / "pages" / f"page-{page:04d}" / "candidate.png"
            images[page] = load_rgb(source)
        images[page].save(
            output / "pages" / f"page-{page:04d}" / "movement-overlay.png",
            compress_level=9,
        )


def prepare_output(path: Path, force: bool) -> None:
    if path.exists() and any(path.iterdir()):
        if not force:
            raise RuntimeError(f"Output directory is not empty: {path}. Use --force to replace it.")
        if not (path / MARKER).is_file():
            raise RuntimeError(f"Refusing to replace an unmarked directory: {path}")
        shutil.rmtree(path)
    path.mkdir(parents=True, exist_ok=True)
    (path / MARKER).write_text("Generated by scripts/pdf-visual-diff.py\n", encoding="utf-8")


def rasterize_page(
    pdf: Path,
    output: Path,
    dpi: int,
    page: int,
    timeout_seconds: int,
) -> Path:
    output.mkdir(parents=True, exist_ok=True)
    tool = command_path("pdftoppm")
    target = output / f"page-{page:04d}"
    run(
        [
            tool,
            "-png",
            "-r",
            str(dpi),
            "-f",
            str(page),
            "-l",
            str(page),
            "-singlefile",
            str(pdf),
            str(target),
        ],
        timeout_seconds,
    )
    rendered = target.with_suffix(".png")
    if not rendered.is_file():
        raise RuntimeError(f"pdftoppm did not create {rendered}")
    return rendered


def pad(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    rgb = image.convert("RGB")
    if rgb.size == size:
        return rgb
    canvas = Image.new("RGB", size, "white")
    canvas.paste(rgb, (0, 0))
    return canvas


def load_rgb(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGB")


def max_channel(image: Image.Image) -> Image.Image:
    red, green, blue = image.split()
    return ImageChops.lighter(ImageChops.lighter(red, green), blue)


def threshold_mask(magnitude: Image.Image, threshold: int) -> Image.Image:
    floor = max(1, threshold)
    return magnitude.point(lambda value: 255 if value >= floor else 0)


def binary_count(mask: Image.Image) -> int:
    return mask.histogram()[255]


def ink_mask(image: Image.Image, dpi: int) -> Image.Image:
    red, green, blue = image.convert("RGB").split()
    darkest_channel = ImageChops.darker(ImageChops.darker(red, green), blue)
    mask = darkest_channel.point(lambda value: 255 if value <= 247 else 0)
    if dpi == 72:
        return mask
    normalized_size = (
        max(1, round(mask.width * 72 / dpi)),
        max(1, round(mask.height * 72 / dpi)),
    )
    reduced = mask.resize(normalized_size, Image.Resampling.BOX)
    return reduced.point(lambda value: 255 if value else 0)


def dilate(mask: Image.Image, radius: int) -> Image.Image:
    return mask if radius == 0 else mask.filter(ImageFilter.MaxFilter(radius * 2 + 1))


def ink_distance_metrics(reference: Image.Image, candidate: Image.Image, dpi: int) -> dict[str, Any]:
    reference_ink = ink_mask(reference, dpi)
    candidate_ink = ink_mask(candidate, dpi)
    radii = (0, 1, 3, 8)
    unmatched: dict[str, dict[str, int]] = {}
    for radius in radii:
        candidate_near = dilate(candidate_ink, radius)
        reference_near = dilate(reference_ink, radius)
        reference_unmatched = ImageChops.multiply(reference_ink, ImageOps.invert(candidate_near))
        candidate_unmatched = ImageChops.multiply(candidate_ink, ImageOps.invert(reference_near))
        unmatched[str(radius)] = {
            "reference": binary_count(reference_unmatched),
            "candidate": binary_count(candidate_unmatched),
        }

    totals = {
        radius: values["reference"] + values["candidate"]
        for radius, values in unmatched.items()
    }
    distance_buckets = {
        "within1Pt": max(0, totals["0"] - totals["1"]),
        "between1And3Pt": max(0, totals["1"] - totals["3"]),
        "between3And8Pt": max(0, totals["3"] - totals["8"]),
        "beyond8Pt": totals["8"],
    }
    total_ink = binary_count(reference_ink) + binary_count(candidate_ink)
    far_fraction = totals["8"] / max(1, total_ink)
    return {
        "normalizationDpi": 72,
        "inkThreshold": 8,
        "referenceInkPixels": binary_count(reference_ink),
        "candidateInkPixels": binary_count(candidate_ink),
        "unmatchedInkByRadiusPt": unmatched,
        "distanceBuckets": distance_buckets,
        "farUnmatchedFraction": round(far_fraction, 8),
    }


def contiguous_bands(values: list[int], merge_gap: int = 2) -> list[tuple[int, int]]:
    indices = [index for index, value in enumerate(values) if value]
    if not indices:
        return []
    bands: list[tuple[int, int]] = []
    start = previous = indices[0]
    for index in indices[1:]:
        if index - previous > merge_gap + 1:
            bands.append((start, previous + 1))
            start = index
        previous = index
    bands.append((start, previous + 1))
    return bands


def save_artifacts(
    reference: Image.Image,
    candidate: Image.Image,
    difference: Image.Image,
    all_mask: Image.Image,
    strong_mask: Image.Image,
    output: Path,
    label: str,
) -> None:
    reference.save(output / "reference.png", compress_level=9)
    candidate.save(output / "candidate.png", compress_level=9)

    amplified = difference.point(lambda value: min(255, value * 8))
    amplified.save(output / "diff-amplified.png", compress_level=9)

    gray = ImageOps.grayscale(candidate).convert("RGB")
    red = Image.new("RGB", candidate.size, (255, 32, 32))
    all_alpha = all_mask.point(lambda value: 160 if value else 0)
    overlay = Image.composite(red, gray, all_alpha)
    overlay.save(output / "diff-overlay.png", compress_level=9)
    strong_alpha = strong_mask.point(lambda value: 180 if value else 0)
    strong_overlay = Image.composite(red, gray, strong_alpha)
    strong_overlay.save(output / "diff-overlay-strong.png", compress_level=9)

    gap = 12
    header = 32
    width, height = candidate.size
    montage = Image.new("RGB", (width * 3 + gap * 2, height + header), (32, 32, 32))
    draw = ImageDraw.Draw(montage)
    draw.text((8, 8), "reference", fill="white")
    draw.text((width + gap + 8, 8), "candidate", fill="white")
    draw.text((width * 2 + gap * 2 + 8, 8), label, fill="white")
    montage.paste(reference, (0, header))
    montage.paste(candidate, (width + gap, header))
    montage.paste(amplified, (width * 2 + gap * 2, header))
    montage.save(output / "montage.png", compress_level=9)


def compare_page(
    reference_path: Path | None,
    candidate_path: Path | None,
    output: Path,
    dpi: int,
    thresholds: tuple[int, ...],
    strong_threshold: int,
    max_pixels: int,
) -> dict[str, Any]:
    reference_source = load_rgb(reference_path) if reference_path else None
    candidate_source = load_rgb(candidate_path) if candidate_path else None
    available = reference_source or candidate_source
    if available is None:
        raise RuntimeError("A page needs at least one rendered image")
    size = (
        max(reference_source.width if reference_source else 0, candidate_source.width if candidate_source else 0),
        max(reference_source.height if reference_source else 0, candidate_source.height if candidate_source else 0),
    )
    pixels = size[0] * size[1]
    if pixels > max_pixels:
        raise RuntimeError(f"Rendered page has {pixels} pixels, above --max-pixels {max_pixels}")

    blank = Image.new("RGB", size, "white")
    reference = pad(reference_source, size) if reference_source else blank.copy()
    candidate = pad(candidate_source, size) if candidate_source else blank.copy()
    difference = ImageChops.difference(reference, candidate)
    magnitude = max_channel(difference)
    histogram = magnitude.histogram()
    counts = {
        str(threshold): sum(histogram[max(1, threshold) :])
        for threshold in thresholds
    }
    all_mask = threshold_mask(magnitude, 0)
    strong_mask = threshold_mask(magnitude, strong_threshold)
    bbox = strong_mask.getbbox()
    x_projection, y_projection = strong_mask.getprojection()
    bands = contiguous_bands(y_projection)
    stat = ImageStat.Stat(difference)
    mean_absolute = sum(stat.mean) / 3
    root_mean_square = math.sqrt(sum(value * value for value in stat.rms) / 3)
    ink_distance = ink_distance_metrics(reference, candidate, dpi)

    output.mkdir(parents=True, exist_ok=True)
    strong_count = counts[str(strong_threshold)]
    label = f"diff x8 | >= {strong_threshold}: {strong_count / pixels:.3%}"
    save_artifacts(
        reference,
        candidate,
        difference,
        all_mask,
        strong_mask,
        output,
        label,
    )

    points_per_pixel = 72 / dpi
    return {
        "referencePresent": reference_path is not None,
        "candidatePresent": candidate_path is not None,
        "referenceSizePx": list(reference_source.size) if reference_source else None,
        "candidateSizePx": list(candidate_source.size) if candidate_source else None,
        "canvasSizePx": list(size),
        "sizeMismatch": reference_source is not None
        and candidate_source is not None
        and reference_source.size != candidate_source.size,
        "pixelCount": pixels,
        "changedPixelsByThreshold": counts,
        "changedFractionByThreshold": {
            key: round(value / pixels, 8) for key, value in counts.items()
        },
        "meanAbsoluteDifference": round(mean_absolute, 5),
        "rootMeanSquareDifference": round(root_mean_square, 5),
        "inkDistance": ink_distance,
        "strongDifferenceBoundsPx": list(bbox) if bbox else None,
        "strongDifferenceBoundsPt": (
            [round(value * points_per_pixel, 3) for value in bbox] if bbox else None
        ),
        "strongDifferenceBandsPx": [list(band) for band in bands],
        "strongDifferenceBandsPt": [
            [round(value * points_per_pixel, 3) for value in band] for band in bands
        ],
        "artifacts": {
            "reference": str(output / "reference.png"),
            "candidate": str(output / "candidate.png"),
            "amplified": str(output / "diff-amplified.png"),
            "overlay": str(output / "diff-overlay.png"),
            "strongOverlay": str(output / "diff-overlay-strong.png"),
            "movementOverlay": str(output / "movement-overlay.png"),
            "montage": str(output / "montage.png"),
        },
    }


def parse_thresholds(raw: str, strong: int) -> tuple[int, ...]:
    if not 0 <= strong <= 255:
        raise ValueError("--strong-threshold must be between 0 and 255")
    values = {strong}
    for part in raw.split(","):
        value = int(part.strip())
        if not 0 <= value <= 255:
            raise ValueError("Thresholds must be between 0 and 255")
        values.add(value)
    return tuple(sorted(values))


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(
        description="Render two PDFs to lossless PNGs and highlight pixel differences."
    )
    result.add_argument("reference", type=Path)
    result.add_argument("candidate", type=Path)
    result.add_argument("--output", required=True, type=Path)
    result.add_argument("--dpi", type=int, default=150)
    result.add_argument("--text-backend", choices=["poppler", "mupdf"], default="poppler")
    result.add_argument("--thresholds", default="0,8,16,28,64")
    result.add_argument("--strong-threshold", type=int, default=28)
    result.add_argument("--max-pages", type=int, default=500)
    result.add_argument("--max-pixels", type=int, default=40_000_000)
    result.add_argument("--max-total-pixels", type=int, default=250_000_000)
    result.add_argument("--max-words", type=int, default=100_000)
    result.add_argument("--max-words-per-page", type=int, default=20_000)
    result.add_argument("--max-bbox-bytes", type=int, default=32_000_000)
    result.add_argument("--max-pdf-bytes", type=int, default=64 * 1024 * 1024)
    result.add_argument("--timeout-seconds", type=int, default=120)
    result.add_argument("--force", action="store_true")
    result.add_argument("--fail-above-percent", type=float)
    result.add_argument(
        "--fail-on-severity",
        choices=("minor", "moderate", "major", "critical"),
    )
    return result


def main(arguments: list[str] | None = None) -> int:
    options = parser().parse_args(arguments)
    if not 36 <= options.dpi <= 600:
        raise ValueError("--dpi must be between 36 and 600")
    if not 1 <= options.max_pages <= 10_000:
        raise ValueError("--max-pages must be between 1 and 10000")
    if options.max_pixels < 1 or options.max_total_pixels < 1:
        raise ValueError("Pixel limits must be positive")
    if (
        options.max_words < 1
        or options.max_words_per_page < 1
        or options.max_bbox_bytes < 1
        or options.max_pdf_bytes < 1
    ):
        raise ValueError("Word and PDF byte limits must be positive")
    if not 1 <= options.timeout_seconds <= 3_600:
        raise ValueError("--timeout-seconds must be between 1 and 3600")
    if options.fail_above_percent is not None and options.fail_above_percent < 0:
        raise ValueError("--fail-above-percent must not be negative")
    for pdf in (options.reference, options.candidate):
        if not pdf.is_file():
            raise FileNotFoundError(pdf)
        if pdf.stat().st_size > options.max_pdf_bytes:
            raise RuntimeError(
                f"{pdf} has {pdf.stat().st_size} bytes, above --max-pdf-bytes "
                f"{options.max_pdf_bytes}"
            )
    thresholds = parse_thresholds(options.thresholds, options.strong_threshold)
    reference_info = document_info(
        options.reference,
        options.max_pages,
        options.timeout_seconds,
    )
    candidate_info = document_info(
        options.candidate,
        options.max_pages,
        options.timeout_seconds,
    )
    reference_pages = reference_info["pages"]
    candidate_pages = candidate_info["pages"]
    compared_pages = max(reference_pages, candidate_pages)
    estimated_pixels = validate_render_budget(
        reference_info,
        candidate_info,
        options.dpi,
        options.max_pixels,
        options.max_total_pixels,
    )
    reference_words = extract_words(
        options.reference,
        options.max_words,
        options.max_words_per_page,
        options.max_bbox_bytes,
        options.timeout_seconds,
        options.text_backend,
    )
    candidate_words = extract_words(
        options.candidate,
        options.max_words,
        options.max_words_per_page,
        options.max_bbox_bytes,
        options.timeout_seconds,
        options.text_backend,
    )
    text_movement, movement_pairs = compare_word_movement(reference_words, candidate_words)
    prepare_output(options.output, options.force)

    page_reports: list[dict[str, Any]] = []
    with tempfile.TemporaryDirectory(prefix="pdf-visual-diff-") as temporary:
        temporary_root = Path(temporary)
        for index in range(compared_pages):
            reference_rendered = (
                rasterize_page(
                    options.reference,
                    temporary_root / "reference",
                    options.dpi,
                    index + 1,
                    options.timeout_seconds,
                )
                if index < reference_pages
                else None
            )
            candidate_rendered = (
                rasterize_page(
                    options.candidate,
                    temporary_root / "candidate",
                    options.dpi,
                    index + 1,
                    options.timeout_seconds,
                )
                if index < candidate_pages
                else None
            )
            page_reports.append(
                compare_page(
                    reference_rendered,
                    candidate_rendered,
                    options.output / "pages" / f"page-{index + 1:04d}",
                    options.dpi,
                    thresholds,
                    options.strong_threshold,
                    options.max_pixels,
                )
            )
            if reference_rendered:
                reference_rendered.unlink()
            if candidate_rendered:
                candidate_rendered.unlink()

    save_movement_overlays(
        movement_pairs,
        options.output,
        options.dpi,
        compared_pages,
    )
    total_pixels = sum(page["pixelCount"] for page in page_reports)
    if total_pixels > options.max_total_pixels:
        raise RuntimeError(
            f"Rendered comparison has {total_pixels} pixels, above --max-total-pixels "
            f"{options.max_total_pixels}"
        )
    aggregate_counts = {
        str(threshold): sum(
            page["changedPixelsByThreshold"][str(threshold)] for page in page_reports
        )
        for threshold in thresholds
    }
    total_ink = sum(
        page["inkDistance"]["referenceInkPixels"] + page["inkDistance"]["candidateInkPixels"]
        for page in page_reports
    )
    far_ink = sum(
        page["inkDistance"]["distanceBuckets"]["beyond8Pt"] for page in page_reports
    )
    far_ink_fraction = far_ink / max(1, total_ink)
    displaced_ink = far_ink + sum(
        page["inkDistance"]["distanceBuckets"]["between3And8Pt"] for page in page_reports
    )
    displaced_ink_fraction = displaced_ink / max(1, total_ink)
    ink_penalty = sum(
        page["inkDistance"]["distanceBuckets"]["within1Pt"] * 0.25
        + page["inkDistance"]["distanceBuckets"]["between1And3Pt"]
        + page["inkDistance"]["distanceBuckets"]["between3And8Pt"] * 4
        + page["inkDistance"]["distanceBuckets"]["beyond8Pt"] * 10
        for page in page_reports
    )
    ink_movement_score = min(100, ink_penalty * 100 / max(1, total_ink))
    movement_severity = text_movement["severity"]
    if reference_pages != candidate_pages:
        movement_severity = "critical"
    elif movement_severity in {"equal", "minor"}:
        if far_ink_fraction > 0.01:
            movement_severity = "major"
        elif displaced_ink_fraction > 0.001:
            movement_severity = "moderate"
        elif aggregate_counts[str(options.strong_threshold)] > 0:
            movement_severity = "minor"
    movement_score = max(
        text_movement["movementScore"],
        ink_movement_score,
    )
    if reference_pages != candidate_pages:
        movement_score = 100
    report = {
        "schemaVersion": 2,
        "textBackend": options.text_backend,
        "reference": str(options.reference.resolve()),
        "candidate": str(options.candidate.resolve()),
        "dpi": options.dpi,
        "tools": {
            "pillow": pillow_version,
            "pdfinfo": run(
                [command_path("pdfinfo"), "-v"],
                options.timeout_seconds,
            ).splitlines()[0],
            "pdftoppm": run(
                [command_path("pdftoppm"), "-v"],
                options.timeout_seconds,
            ).splitlines()[0],
            "pdftotext": run(
                [command_path("pdftotext"), "-v"],
                options.timeout_seconds,
            ).splitlines()[0],
        },
        "thresholds": list(thresholds),
        "strongThreshold": options.strong_threshold,
        "limits": {
            "maxPages": options.max_pages,
            "maxPixels": options.max_pixels,
            "maxTotalPixels": options.max_total_pixels,
            "maxWords": options.max_words,
            "maxWordsPerPage": options.max_words_per_page,
            "maxBboxBytes": options.max_bbox_bytes,
            "maxPdfBytes": options.max_pdf_bytes,
            "timeoutSeconds": options.timeout_seconds,
        },
        "referencePages": reference_pages,
        "candidatePages": candidate_pages,
        "pageCountMismatch": reference_pages != candidate_pages,
        "estimatedPixels": estimated_pixels,
        "movementSeverity": movement_severity,
        "movementScore": round(movement_score, 4),
        "inkMovementScore": round(ink_movement_score, 4),
        "textMovement": text_movement,
        "farInkFraction": round(far_ink_fraction, 8),
        "displacedInkFraction": round(displaced_ink_fraction, 8),
        "totalPixels": total_pixels,
        "changedPixelsByThreshold": aggregate_counts,
        "changedFractionByThreshold": {
            key: round(value / total_pixels, 8) for key, value in aggregate_counts.items()
        },
        "pages": page_reports,
    }
    report_path = options.output / "report.json"
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    strong_fraction = report["changedFractionByThreshold"][str(options.strong_threshold)]
    print(
        json.dumps(
            {
                "report": str(report_path),
                "pages": compared_pages,
                "pageCountMismatch": report["pageCountMismatch"],
                "strongChangedPercent": round(strong_fraction * 100, 4),
                "movementSeverity": movement_severity,
                "movementScore": round(movement_score, 4),
            },
            indent=2,
        )
    )
    if (
        options.fail_above_percent is not None
        and strong_fraction * 100 > options.fail_above_percent
    ):
        return 2
    severity_rank = {
        "equal": 0,
        "minor": 1,
        "moderate": 2,
        "major": 3,
        "critical": 4,
    }
    if (
        options.fail_on_severity is not None
        and severity_rank[movement_severity] >= severity_rank[options.fail_on_severity]
    ):
        return 2
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        OSError,
        RuntimeError,
        ValueError,
        subprocess.CalledProcessError,
        subprocess.TimeoutExpired,
    ) as error:
        print(f"pdf-visual-diff: {error}", file=sys.stderr)
        raise SystemExit(1)
