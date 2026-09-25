"""Linear pagination/text screening. No rasterization or geometric matching."""
import argparse
from collections import Counter
import gzip
import hashlib
import json
from pathlib import Path
import unicodedata

INDEX_VERSION = "page-words-nfc-v1"
COMPARE_VERSION = "page-word-multiset-v1"
MAX_PAGES = 1000
MAX_WORDS = 250000
MAX_BYTES = 64 * 1024 * 1024


def signature(tokens):
    return hashlib.sha256(json.dumps(tokens, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


def index_pages(pages):
    dictionary, ids, output = [], {}, []
    total = 0
    for page in pages:
        tokens = []
        for raw in page:
            # Preserve case, punctuation, and hyphens. Do not hide text differences.
            word = unicodedata.normalize("NFC", raw)
            if word not in ids:
                ids[word] = len(dictionary)
                dictionary.append(word)
            tokens.append(ids[word])
            total += 1
            if total > MAX_WORDS:
                raise ValueError("Text index exceeds word limit")
        output.append(tokens)
        if len(output) > MAX_PAGES:
            raise ValueError("Text index exceeds page limit")
    if not output:
        raise ValueError("Empty document")
    return dict(version=INDEX_VERSION, dictionary=dictionary, pages=output, words=total)


def measure_pdf(path):
    import pymupdf
    with pymupdf.open(path) as doc:
        if doc.needs_pass or doc.is_repaired or not 0 < len(doc) <= MAX_PAGES:
            raise ValueError("Encrypted, repaired, empty, or oversized PDF")
        return index_pages(
            (word[4] for word in page.get_text(
                "words", flags=pymupdf.TEXTFLAGS_WORDS | pymupdf.TEXT_IGNORE_ACTUALTEXT
            )) for page in doc
        )


def from_measurement(value):
    pages = [[] for _ in value["pages"]]
    if not 0 < len(pages) <= MAX_PAGES:
        raise ValueError("Invalid page count")
    for word in value["words"]:
        page = word["page"]
        if not isinstance(page, int) or not 1 <= page <= len(pages):
            raise ValueError("Invalid word page")
        pages[page - 1].append(word["text"])
    return index_pages(pages)


def read(path):
    with gzip.open(path, "rb") as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("Text artifact exceeds byte limit")
    return json.loads(raw)


def validate(index):
    if index.get("version") != INDEX_VERSION:
        raise ValueError("Incompatible text index")
    dictionary, pages = index["dictionary"], index["pages"]
    if not 0 < len(pages) <= MAX_PAGES or len(dictionary) > MAX_WORDS:
        raise ValueError("Invalid text index size")
    if any(not isinstance(word, str) for word in dictionary) or len(set(dictionary)) != len(dictionary):
        raise ValueError("Invalid token dictionary")
    count = 0
    for page in pages:
        count += len(page)
        if count > MAX_WORDS or any(type(i) is not int or not 0 <= i < len(dictionary) for i in page):
            raise ValueError("Invalid token sequence")
    if count != index["words"]:
        raise ValueError("Invalid word count")


def compare(left, right):
    validate(left)
    validate(right)
    # Map once into one vocabulary. Every occurrence, including repeats, contributes once.
    vocabulary = {word: i for i, word in enumerate(left["dictionary"])}
    mapping = []
    for word in right["dictionary"]:
        mapping.append(vocabulary.setdefault(word, len(vocabulary)))
    ref_total, candidate_total = Counter(), Counter()
    same_page, exact_pages, differing = 0, 0, []
    left_pages, right_pages = left["pages"], right["pages"]
    for page in range(max(len(left_pages), len(right_pages))):
        a = left_pages[page] if page < len(left_pages) else []
        b = [mapping[i] for i in right_pages[page]] if page < len(right_pages) else []
        ac, bc = Counter(a), Counter(b)
        ref_total.update(ac)
        candidate_total.update(bc)
        overlap = sum((ac & bc).values())
        same_page += overlap
        equal = page < min(len(left_pages), len(right_pages)) and a == b
        exact_pages += equal
        if not equal:
            differing.append(dict(page=page + 1, referenceWords=len(a), candidateWords=len(b),
                                  unmatchedOccurrences=len(a) + len(b) - 2 * overlap))
    common = sum((ref_total & candidate_total).values())
    moved = common - same_page
    missing, extra = left["words"] - common, right["words"] - common
    page_error = abs(len(left_pages) - len(right_pages))
    main = ("pagination" if page_error or moved else "text-mismatch" if missing or extra
            else "word-order" if differing else "none")
    return dict(version=COMPARE_VERSION, scope="pagination-text-screen", mainIssue=main,
                referencePages=len(left_pages), candidatePages=len(right_pages),
                absolutePageError=page_error, matchingPageCount=page_error == 0,
                referenceWords=left["words"], candidateWords=right["words"],
                missingWords=missing, extraWords=extra, minimumMovedWords=moved,
                samePageWordOccurrences=same_page, exactTextPages=exact_pages,
                differentTextPages=len(differing), firstDifferences=differing[:3],
                visualStatus="not-measured", movementStatus="multiset-lower-bound")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=["pdf", "measurement"])
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    value = measure_pdf(args.source) if args.operation == "pdf" else from_measurement(read(args.source))
    with gzip.open(args.output, "wt", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, separators=(",", ":"))
    print(json.dumps(dict(status="indexed", pages=len(value["pages"]), words=value["words"])))


if __name__ == "__main__":
    main()
