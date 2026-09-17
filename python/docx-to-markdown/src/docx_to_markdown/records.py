"""Typed records for everything a conversion returns.

Each record mirrors one interface of the Node.js converter, with snake_case names.
Unknown keys from a newer runtime are ignored, and optional fields default to ``None``,
so a wheel keeps working against a slightly newer converter.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Literal, cast

Coverage = Literal["complete", "partial", "none"]
FontStyle = Literal["normal", "italic"]
DisplayMode = Literal["all-markup", "proposed", "original"]
Story = str
"""Story kind such as ``"body"``, ``"header"``, ``"footer"``, ``"footnote"``, or ``"textbox"``."""


def _str(value: Any, default: str = "") -> str:
    return value if isinstance(value, str) else default


def _int(value: Any, default: int = 0) -> int:
    return value if isinstance(value, int) and not isinstance(value, bool) else default


def _opt_str(value: Any) -> str | None:
    return value if isinstance(value, str) else None


def _opt_int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _list(value: Any) -> list[Any]:
    return list(cast("list[Any]", value)) if isinstance(value, (list, tuple)) else []


# Fonts ------------------------------------------------------------------------------


@dataclass(frozen=True)
class FontRequest:
    """One face as a document asks for it."""

    family: str
    weight: int
    style: FontStyle

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> FontRequest:
        style = data.get("style")
        return cls(
            family=_str(data.get("family")),
            weight=_int(data.get("weight"), 400),
            style="italic" if style == "italic" else "normal",
        )


@dataclass(frozen=True)
class FontSubstitution:
    """A requested face served by a metric-compatible one."""

    requested: FontRequest
    resolved: FontRequest

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> FontSubstitution:
        return cls(
            requested=FontRequest.from_json(data.get("requested") or {}),
            resolved=FontRequest.from_json(data.get("resolved") or {}),
        )


@dataclass(frozen=True)
class FontFaceResolution:
    """Which font file measured one face of a family."""

    weight: int
    style: FontStyle
    source_family: str
    via: Literal["direct", "substitution"]
    id: str | None = None
    hash: str | None = None
    identity: str | None = None
    face_index: int | None = None
    substitution: FontSubstitution | None = None

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> FontFaceResolution:
        substitution = data.get("substitution")
        return cls(
            weight=_int(data.get("weight"), 400),
            style="italic" if data.get("style") == "italic" else "normal",
            source_family=_str(data.get("sourceFamily")),
            via="substitution" if data.get("via") == "substitution" else "direct",
            id=_opt_str(data.get("id")),
            hash=_opt_str(data.get("hash")),
            identity=_opt_str(data.get("identity")),
            face_index=_opt_int(data.get("faceIndex")),
            substitution=FontSubstitution.from_json(cast("Mapping[str, Any]", substitution))
            if isinstance(substitution, Mapping)
            else None,
        )


@dataclass(frozen=True)
class FontFamilyResolution:
    """How one family the document uses was measured."""

    family: str
    coverage: Coverage
    faces: list[FontFaceResolution] = field(default_factory=lambda: [])

    @property
    def complete(self) -> bool:
        return self.coverage == "complete"

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> FontFamilyResolution:
        coverage = data.get("coverage")
        return cls(
            family=_str(data.get("family")),
            coverage=coverage if coverage in ("complete", "partial", "none") else "none",
            faces=[FontFaceResolution.from_json(f) for f in _list(data.get("faces"))],
        )


@dataclass(frozen=True)
class FontOriginFailure:
    """A font source that failed as a whole, for example a fetch that errored."""

    origin_index: int
    cause: str
    origin_name: str | None = None

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> FontOriginFailure:
        cause = data.get("cause")
        return cls(
            origin_index=_int(data.get("originIndex")),
            cause=cause if isinstance(cause, str) else repr(cause),
            origin_name=_opt_str(data.get("originName")),
        )


@dataclass(frozen=True)
class DroppedEmbeddedFont:
    """A font embedded in the DOCX that the converter refused to load."""

    request: FontRequest
    part_name: str
    reason: Literal["overLimit", "malformed"]

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> DroppedEmbeddedFont:
        return cls(
            request=FontRequest.from_json(data.get("request") or {}),
            part_name=_str(data.get("partName")),
            reason="malformed" if data.get("reason") == "malformed" else "overLimit",
        )


@dataclass(frozen=True)
class FontResolution:
    """Evidence for the faces behind the page breaks."""

    requested_families: list[str]
    default_family: str
    families: list[FontFamilyResolution]
    origin_failures: list[FontOriginFailure] = field(default_factory=lambda: [])
    dropped_embedded_fonts: list[DroppedEmbeddedFont] = field(default_factory=lambda: [])

    @property
    def complete(self) -> bool:
        """Every family measured with all of its faces and no origin failed."""
        return not self.origin_failures and all(f.complete for f in self.families)

    @property
    def missing(self) -> list[str]:
        """Families that did not measure with all of their faces."""
        return [f.family for f in self.families if not f.complete]

    def family(self, name: str) -> FontFamilyResolution | None:
        return next((f for f in self.families if f.family == name), None)

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> FontResolution:
        return cls(
            requested_families=[_str(f) for f in _list(data.get("requestedFamilies"))],
            default_family=_str(data.get("defaultFamily")),
            families=[FontFamilyResolution.from_json(f) for f in _list(data.get("families"))],
            origin_failures=[
                FontOriginFailure.from_json(f) for f in _list(data.get("originFailures"))
            ],
            dropped_embedded_fonts=[
                DroppedEmbeddedFont.from_json(f) for f in _list(data.get("droppedEmbeddedFonts"))
            ],
        )


# Review artifacts -------------------------------------------------------------------


@dataclass(frozen=True)
class ReviewOccurrence:
    """Where a comment or tracked change lands on a page."""

    page_index: int
    page_number: int
    story: Story
    root_story: Story
    textbox_path: list[str] = field(default_factory=lambda: [])
    note_scope_id: str | None = None
    note_area_kind: Literal["footnotes", "endnotes"] | None = None
    revision_role: Literal["replaced", "replacement", "neutral"] | None = None
    source: Mapping[str, Any] = field(default_factory=lambda: {})
    """The engine's anchor for this occurrence, kept as the converter reports it."""
    geometry: Mapping[str, Any] | None = None

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> ReviewOccurrence:
        note_area = data.get("noteAreaKind")
        role = data.get("revisionRole")
        source = data.get("source")
        geometry = data.get("geometry")
        return cls(
            page_index=_int(data.get("pageIndex")),
            page_number=_int(data.get("physicalPageNumber")),
            story=_str(data.get("story")),
            root_story=_str(data.get("rootStory")),
            textbox_path=[_str(p) for p in _list(data.get("textboxPath"))],
            note_scope_id=_opt_str(data.get("noteScopeId")),
            note_area_kind=note_area if note_area in ("footnotes", "endnotes") else None,
            revision_role=role if role in ("replaced", "replacement", "neutral") else None,
            source=dict(cast("Mapping[str, Any]", source)) if isinstance(source, Mapping) else {},
            geometry=dict(cast("Mapping[str, Any]", geometry))
            if isinstance(geometry, Mapping)
            else None,
        )


@dataclass(frozen=True)
class Comment:
    """One comment, with its thread links and page occurrences."""

    id: str
    author: str
    initials: str
    text: str
    resolved: bool
    orphaned: bool
    date: str | None = None
    parent_id: str | None = None
    parent_revision_id: str | None = None
    reply_ids: list[str] = field(default_factory=lambda: [])
    occurrences: list[ReviewOccurrence] = field(default_factory=lambda: [])
    kind: Literal["comment"] = "comment"

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> Comment:
        return cls(
            id=_str(data.get("id")),
            author=_str(data.get("author")),
            initials=_str(data.get("initials")),
            text=_str(data.get("text")),
            resolved=bool(data.get("resolved")),
            orphaned=bool(data.get("orphaned")),
            date=_opt_str(data.get("date")),
            parent_id=_opt_str(data.get("parentId")),
            parent_revision_id=_opt_str(data.get("parentRevisionId")),
            reply_ids=[_str(r) for r in _list(data.get("replyIds"))],
            occurrences=[ReviewOccurrence.from_json(o) for o in _list(data.get("occurrences"))],
        )


ChangeKind = Literal[
    "insert",
    "delete",
    "replace",
    "moveFrom",
    "moveTo",
    "format",
    "paragraphMark",
    "structural",
]
_CHANGE_KINDS = (
    "insert",
    "delete",
    "replace",
    "moveFrom",
    "moveTo",
    "format",
    "paragraphMark",
    "structural",
)


@dataclass(frozen=True)
class TrackedChange:
    """One tracked change, with its text and page occurrences."""

    id: str
    change: ChangeKind
    author: str
    text: str
    replaced_text: str
    nesting: int
    read_only: bool
    date: str | None = None
    mark_direction: Literal["insert", "delete", "moveFrom", "moveTo"] | None = None
    replaced_range_count: int | None = None
    paired_with: str | None = None
    reply_ids: list[str] = field(default_factory=lambda: [])
    occurrences: list[ReviewOccurrence] = field(default_factory=lambda: [])
    kind: Literal["tracked-change"] = "tracked-change"

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> TrackedChange:
        change = data.get("change")
        direction = data.get("markDirection")
        return cls(
            id=_str(data.get("id")),
            change=change if change in _CHANGE_KINDS else "structural",
            author=_str(data.get("author")),
            text=_str(data.get("text")),
            replaced_text=_str(data.get("replacedText")),
            nesting=_int(data.get("nesting")),
            read_only=bool(data.get("readOnly")),
            date=_opt_str(data.get("date")),
            mark_direction=direction
            if direction in ("insert", "delete", "moveFrom", "moveTo")
            else None,
            replaced_range_count=_opt_int(data.get("replacedRangeCount")),
            paired_with=_opt_str(data.get("pairedWith")),
            reply_ids=[_str(r) for r in _list(data.get("replyIds"))],
            occurrences=[ReviewOccurrence.from_json(o) for o in _list(data.get("occurrences"))],
        )


ReviewArtifact = Comment | TrackedChange


def review_artifact_from_json(data: Mapping[str, Any]) -> ReviewArtifact:
    if data.get("kind") == "comment":
        return Comment.from_json(data)
    return TrackedChange.from_json(data)


@dataclass(frozen=True)
class ReviewRange:
    """A span of Markdown, in UTF-16 code units, that an artifact maps to."""

    start: int
    end: int
    precision: Literal["exact", "containing-construct"]
    unit: Literal["utf16-code-unit"] = "utf16-code-unit"

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> ReviewRange:
        return cls(
            start=_int(data.get("start")),
            end=_int(data.get("end")),
            precision="exact" if data.get("precision") == "exact" else "containing-construct",
        )


@dataclass(frozen=True)
class DocumentProjection:
    """Offsets into ``MarkdownResult.markdown``."""

    kind: Literal["document"] = "document"


@dataclass(frozen=True)
class PageProjection:
    """Offsets into one field of one page."""

    page_index: int
    page_number: int
    field: Literal["markdown", "headerMarkdown", "footerMarkdown"]
    kind: Literal["page"] = "page"


ReviewProjection = DocumentProjection | PageProjection


def _projection_from_json(data: Mapping[str, Any]) -> ReviewProjection:
    if data.get("kind") == "page":
        field_name = data.get("field")
        return PageProjection(
            page_index=_int(data.get("pageIndex")),
            page_number=_int(data.get("pageNumber")),
            field=field_name
            if field_name in ("markdown", "headerMarkdown", "footerMarkdown")
            else "markdown",
        )
    return DocumentProjection()


@dataclass(frozen=True)
class ReviewBinding:
    """Where one occurrence of a comment or tracked change sits in the Markdown."""

    artifact_id: str
    artifact_kind: Literal["comment", "tracked-change"]
    occurrence_index: int
    projection: ReviewProjection
    coverage: Coverage
    ranges: list[ReviewRange] = field(default_factory=lambda: [])
    unmapped_reason: (
        Literal[
            "not-represented-in-markdown", "non-linear-structural-change", "omitted-story-content"
        ]
        | None
    ) = None

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> ReviewBinding:
        coverage = data.get("coverage")
        reason = data.get("unmappedReason")
        return cls(
            artifact_id=_str(data.get("artifactId")),
            artifact_kind="comment" if data.get("artifactKind") == "comment" else "tracked-change",
            occurrence_index=_int(data.get("occurrenceIndex")),
            projection=_projection_from_json(data.get("projection") or {}),
            coverage=coverage if coverage in ("complete", "partial", "none") else "none",
            ranges=[ReviewRange.from_json(r) for r in _list(data.get("ranges"))],
            unmapped_reason=reason
            if reason
            in (
                "not-represented-in-markdown",
                "non-linear-structural-change",
                "omitted-story-content",
            )
            else None,
        )


# Images and pagination --------------------------------------------------------------


@dataclass(frozen=True)
class ImageOccurrence:
    """One placement of an image on a page."""

    page_number: int
    story: Story
    root_story: Story
    part_name: str
    drawing_node_id: str
    paragraph_id: str
    start: int
    display_width_px: int
    display_height_px: int
    kind: Literal["inline", "anchored"]
    decorative: bool
    alt: str

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> ImageOccurrence:
        return cls(
            page_number=_int(data.get("pageNumber")),
            story=_str(data.get("story")),
            root_story=_str(data.get("rootStory")),
            part_name=_str(data.get("partName")),
            drawing_node_id=_str(data.get("drawingNodeId")),
            paragraph_id=_str(data.get("paragraphId")),
            start=_int(data.get("start")),
            display_width_px=_int(data.get("displayWidthPx")),
            display_height_px=_int(data.get("displayHeightPx")),
            kind="anchored" if data.get("kind") == "anchored" else "inline",
            decorative=bool(data.get("decorative")),
            alt=_str(data.get("alt")),
        )


@dataclass(frozen=True)
class Pagination:
    """How the pages were produced."""

    layout_revision: int
    display_mode: DisplayMode
    source: str = "layout-engine"
    scope: str = "export-snapshot"

    @classmethod
    def from_json(cls, data: Mapping[str, Any]) -> Pagination:
        mode = data.get("displayMode")
        return cls(
            layout_revision=_int(data.get("layoutRevision")),
            display_mode=mode if mode in ("all-markup", "proposed", "original") else "all-markup",
            source=_str(data.get("source"), "layout-engine"),
            scope=_str(data.get("scope"), "export-snapshot"),
        )
