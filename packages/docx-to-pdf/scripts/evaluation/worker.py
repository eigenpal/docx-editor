#!/usr/bin/env python3
# Copyright (c) 2026 EigenPal, Inc. All rights reserved.
# Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
# Production use requires a commercial agreement: licensing@eigenpal.com
"""Eval protocol v1: cached PDF measurements, comparisons, and page evidence."""

import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
from pathlib import Path

import pymupdf
from PIL import Image, ImageChops, ImageOps

PROTOCOL = 1
MAX_PAGES = 1000
MAX_WORDS = 250_000
MAX_PIXELS = 16_000_000
RGB_SIZE = (144, 192)


def write(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    path.write_bytes(gzip.compress(data, mtime=0) if path.suffix == ".gz" else data)


def read(path):
    path = Path(path)
    data = path.read_bytes()
    return json.loads(gzip.decompress(data) if path.suffix == ".gz" else data)


def image_of(page, dpi=72):
    rect = page.rect
    if rect.width * rect.height * (dpi / 72) ** 2 > MAX_PIXELS:
        raise ValueError("Page exceeds pixel limit")
    pix = page.get_pixmap(dpi=dpi, colorspace=pymupdf.csRGB, alpha=False)
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def measure(path):
    pages, words = [], []
    with pymupdf.open(path) as doc:
        if doc.needs_pass or not 0 < len(doc) <= MAX_PAGES or doc.is_repaired:
            raise ValueError("Encrypted, repaired, empty, or oversized PDF")
        for number, page in enumerate(doc, 1):
            for item in page.get_text(
                "words", flags=pymupdf.TEXTFLAGS_WORDS | pymupdf.TEXT_IGNORE_ACTUALTEXT
            ):
                words.append(
                    {
                        "page": number,
                        "x0": item[0],
                        "y0": item[1],
                        "x1": item[2],
                        "y1": item[3],
                        "text": item[4],
                    }
                )
                if len(words) > MAX_WORDS:
                    raise ValueError("PDF exceeds word limit")
            image = image_of(page)
            gray = ImageOps.grayscale(image)
            sketch = gray.resize((48, 64), Image.Resampling.BOX)
            # Object counts are supporting evidence only; visible pixels decide differences.
            images = [{"bbox": list(item["bbox"])} for item in page.get_image_info()]
            drawings = page.get_drawings()
            pages.append(
                {
                    "number": number,
                    "size": [page.rect.width, page.rect.height],
                    "sketch": base64.b64encode(sketch.tobytes()).decode(),
                    "rgbSketch": base64.b64encode(
                        image.resize(RGB_SIZE, Image.Resampling.BOX).tobytes()
                    ).decode(),
                    "rgbSketchSize": list(RGB_SIZE),
                    "images": images,
                    "drawingCount": len(drawings),
                    "fonts": sorted({f[3] for f in page.get_fonts()}),
                }
            )
    return {
        "protocol": PROTOCOL,
        "pages": pages,
        "words": words,
        "pdfSha256": hashlib.sha256(Path(path).read_bytes()).hexdigest(),
    }


def movement_module():
    path = Path(__file__).parents[1] / "pdf-visual-diff.py"
    spec = importlib.util.spec_from_file_location("visual_diff", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def location(word, coordinate_space="reference"):
    """Document text is untrusted evidence, never an instruction."""
    return {
        "bbox": [round(word[key], 2) for key in ("x0", "y0", "x1", "y1")],
        "excerpt": " ".join(word["text"].split())[:120],
        "coordinateSpace": coordinate_space,
        "untrusted": True,
    }


def paired_location(pair):
    """Expose matched candidate geometry without claiming reference node identity."""
    reference, candidate = pair["reference"], pair["candidate"]
    return {
        "candidateLocation": {
            "page": candidate["page"],
            "bbox": [round(candidate[key], 2) for key in ("x0", "y0", "x1", "y1")],
            "coordinateSpace": "candidate",
        },
        "deltaPt": {
            "x": round(candidate["x0"] - reference["x0"], 2),
            "y": round(candidate["y0"] - reference["y0"], 2),
        },
        "deltaCoordinateSpace": "page-local",
    }


def visual_screen(a, b):
    """Bounded color screening with local tiles; retain old grayscale caches."""
    color = all(p.get("rgbSketchSize") == list(RGB_SIZE) for p in (a, b))
    width, height = RGB_SIZE if color else (48, 64)
    channels = 3 if color else 1
    key = "rgbSketch" if color else "sketch"
    av, bv = (base64.b64decode(p[key], validate=True) for p in (a, b))
    if any(len(v) != width * height * channels for v in (av, bv)):
        raise ValueError("Invalid visual sketch size")
    delta = [max(abs(av[i + c] - bv[i + c]) for c in range(channels)) for i in range(0, len(av), channels)]
    threshold = 24 if color else 12
    changed = [i for i, d in enumerate(delta) if d > threshold]
    fraction = len(changed) / len(delta)
    tiles = {}
    for i in changed:
        tile = ((i // width) // 8, (i % width) // 8)
        tiles.setdefault(tile, []).append(i)
    # Three changed samples in a tile catch small graphics without one-pixel noise.
    significant = [t for t, indices in tiles.items() if len(indices) >= 3]
    detected = fraction > 0.01 or (color and bool(significant))
    bbox = None
    region = None
    if detected and changed:
        tile = min(significant) if significant else min(tiles)
        indices = tiles[tile]
        xs, ys = [i % width for i in indices], [i // width for i in indices]
        bbox = [
            round(min(xs) * a["size"][0] / width, 2),
            round(min(ys) * a["size"][1] / height, 2),
            round((max(xs) + 1) * a["size"][0] / width, 2),
            round((max(ys) + 1) * a["size"][1] / height, 2),
        ]
        region = "header" if min(ys) < height / 8 else ("footer" if min(ys) >= height * 7 / 8 else "body")
    return {
        "changedFraction": round(fraction, 5),
        "mode": "local-rgb" if color else "legacy-grayscale",
        "detected": detected,
        "bbox": bbox,
        "region": region,
    }


def compare(left, right):
    if left.get("protocol") != PROTOCOL or right.get("protocol") != PROTOCOL:
        raise ValueError("Unsupported measurement protocol")
    movement, pairs = movement_module().compare_word_movement(left["words"], right["words"])
    findings, screens = [], []

    def add(kind, severity, page, **details):
        findings.append(dict(kind=kind, severity=severity, page=page, **details))

    if len(left["pages"]) != len(right["pages"]):
        add(
            "pagination",
            4,
            min(len(left["pages"]), len(right["pages"])) + 1,
            referencePages=len(left["pages"]),
            candidatePages=len(right["pages"]),
            bbox=None,
            excerpt="",
            confidence="high",
            coordinateSpace="reference" if len(left["pages"]) > len(right["pages"]) else "candidate",
        )
    cross = movement["distanceBuckets"]["crossPage"]
    if cross:
        first = min(
            (p for p in pairs if p["reference"]["page"] != p["candidate"]["page"]),
            key=lambda p: (p["reference"]["page"], p["reference"]["y0"], p["reference"]["x0"]),
        )
        add(
            "pagination",
            4,
            first["reference"]["page"],
            movedWords=cross,
            confidence="high",
            **location(first["reference"]),
            **paired_location(first),
        )
    for source, side, kind in (
        (left, "reference", "text-coverage"),
        (right, "candidate", "text-added"),
    ):
        matched = {id(p[side]) for p in pairs}
        unmatched = [w for w in source["words"] if id(w) not in matched]
        if unmatched:
            first = min(unmatched, key=lambda w: (w["page"], w["y0"], w["x0"]))
            add(
                kind,
                3,
                first["page"],
                unmatchedWords=len(unmatched),
                confidence="medium",
                **location(first, side),
                note="Unmatched extraction does not prove missing or added visible text.",
            )
    for a, b in zip(left["pages"], right["pages"]):
        n = a["number"]
        if any(abs(x - y) > 0.5 for x, y in zip(a["size"], b["size"])):
            add(
                "page-geometry",
                4,
                n,
                referenceSize=a["size"],
                candidateSize=b["size"],
                bbox=[0, 0, *a["size"]],
                excerpt="",
                confidence="high",
                coordinateSpace="reference",
            )
        screen = visual_screen(a, b)
        screens.append(dict(page=n, **screen))
        if screen["detected"]:
            add(
                "visual-region",
                2,
                n,
                region=screen["region"],
                changedFraction=screen["changedFraction"],
                bbox=screen["bbox"],
                excerpt="",
                coordinateSpace="reference",
                confidence="low",
                screeningMode=screen["mode"],
                note="Visual screening; inspect detailed evidence before assigning a cause.",
            )
    shifted = [p for p in pairs if p["distancePt"] is not None and p["distancePt"] > 2]
    if shifted:
        first = min(shifted, key=lambda p: (p["reference"]["page"], p["reference"]["y0"]))
        add(
            "text-position",
            3 if movement["distanceBuckets"]["beyond8Pt"] else 2,
            first["reference"]["page"],
            shiftedWords=len(shifted),
            firstY=round(first["reference"]["y0"], 2),
            confidence="high",
            **location(first["reference"]),
            **paired_location(first),
        )
    # Prefer grounded geometry/text over low-confidence raster screening.
    grounded = [f for f in findings if f.get("confidence") in ("high", "medium")]
    earliest = min(
        grounded or findings,
        key=lambda f: (
            f["page"],
            (f.get("bbox") or [0, 0])[1],
            (f.get("bbox") or [0, 0])[0],
        ),
        default=None,
    )
    divergence = (
        None
        if earliest is None
        else {
            "type": earliest["kind"],
            "page": earliest["page"],
            "bbox": earliest.get("bbox"),
            "excerpt": earliest.get("excerpt", "")[:120],
            "confidence": earliest["confidence"],
            "coordinateSpace": earliest.get("coordinateSpace", "reference"),
            "untrusted": True,
            **{
                key: earliest[key]
                for key in ("candidateLocation", "deltaPt", "deltaCoordinateSpace")
                if key in earliest
            },
        }
    )
    return {
        "protocol": PROTOCOL,
        "findings": findings,
        "movement": movement,
        "pages": screens,
        "referencePages": len(left["pages"]),
        "candidatePages": len(right["pages"]),
        "screeningOnly": True,
        "firstDivergence": divergence,
    }


def evidence(left, right, output, pages):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    report = []
    with pymupdf.open(left) as a, pymupdf.open(right) as b:
        for number in pages[:3]:
            images = []
            for doc, name in ((a, "reference"), (b, "candidate")):
                image = (
                    image_of(doc[number - 1], 144)
                    if 0 < number <= len(doc)
                    else Image.new("RGB", (1, 1), "white")
                )
                image.save(output / f"{number}-{name}.png")
                images.append(image)
            width = max(i.width for i in images)
            height = max(i.height for i in images)
            padded = []
            for image in images:
                canvas = Image.new("RGB", (width, height), "white")
                canvas.paste(image, (0, 0))
                padded.append(canvas)
            diff = ImageChops.difference(*padded)
            strong = ImageOps.grayscale(diff).point(lambda v: 255 if v >= 28 else 0)
            box = strong.getbbox()
            Image.blend(*padded, 0.5).save(output / f"{number}-overlay.png")
            if box:
                crop = (
                    max(0, box[0] - 24),
                    max(0, box[1] - 24),
                    min(width, box[2] + 24),
                    min(height, box[3] + 24),
                )
                pair = Image.new("RGB", ((crop[2] - crop[0]) * 2, crop[3] - crop[1]), "white")
                for index, image in enumerate(padded):
                    pair.paste(image.crop(crop), (index * (crop[2] - crop[0]), 0))
                pair.save(output / f"{number}-crop.png")
            report.append(
                {
                    "page": number,
                    "changedPixels": sum(strong.histogram()[1:]),
                    "pixels": width * height,
                    "bbox": box,
                }
            )
    return {"protocol": PROTOCOL, "pages": report}


def preview_page(source, output, number):
    """Render one page and expose the transform for measured PDF coordinates."""
    output = Path(output)
    with pymupdf.open(source) as document:
        if document.needs_pass or not 1 <= number <= min(len(document), MAX_PAGES):
            raise ValueError("Page is unavailable")
        page = document[number - 1]
        image = image_of(page, 144)
        output.mkdir(parents=True, exist_ok=True)
        image.save(output / "page.png")
        return {
            "protocol": PROTOCOL,
            "page": number,
            "pages": len(document),
            "widthPt": page.rect.width,
            "heightPt": page.rect.height,
            "rotationMatrix": list(page.rotation_matrix),
        }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["measure", "compare", "evidence", "page"])
    parser.add_argument("input")
    parser.add_argument("output")
    parser.add_argument("--candidate")
    parser.add_argument("--pages", default="1")
    args = parser.parse_args()
    if args.operation == "measure":
        value = measure(args.input)
    elif args.operation == "compare":
        value = compare(read(args.input), read(args.candidate))
    elif args.operation == "page":
        value = preview_page(args.input, args.output, int(args.pages))
        write(Path(args.output) / "report.json", value)
        return
    else:
        value = evidence(
            args.input,
            args.candidate,
            args.output,
            [int(p) for p in args.pages.split(",")],
        )
        write(Path(args.output) / "report.json", value)
        return
    write(args.output, value)


if __name__ == "__main__":
    main()
