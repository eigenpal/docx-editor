"""The result is typed end to end: no dict access needed for any documented field."""

from docx_to_markdown import (
    Comment,
    DocumentProjection,
    FontResolution,
    PageProjection,
    Pagination,
    ReviewBinding,
    TrackedChange,
    convert,
)


def test_review_records_are_typed(reviewed_document):
    result = convert(reviewed_document)
    assert result.review_artifacts, "fixture should carry comments and tracked changes"
    comments = result.comments
    changes = result.tracked_changes
    assert comments and changes
    assert all(isinstance(c, Comment) and c.kind == "comment" for c in comments)
    assert all(isinstance(t, TrackedChange) and t.kind == "tracked-change" for t in changes)
    first = comments[0]
    assert first.author and isinstance(first.text, str) and isinstance(first.resolved, bool)
    assert all(o.page_number >= 1 and o.story for o in first.occurrences)
    change = changes[0]
    assert change.change in {
        "insert",
        "delete",
        "replace",
        "moveFrom",
        "moveTo",
        "format",
        "paragraphMark",
        "structural",
    }
    assert isinstance(change.nesting, int)
    # Page-level lists reuse the same record types.
    page_comments = [c for p in result.pages for c in p.comments]
    page_changes = [t for p in result.pages for t in p.tracked_changes]
    assert all(isinstance(c, Comment) for c in page_comments)
    assert all(isinstance(t, TrackedChange) for t in page_changes)


def test_review_bindings_point_into_markdown(reviewed_document):
    result = convert(reviewed_document)
    assert result.review_bindings
    ids = {a.id for a in result.review_artifacts}
    for binding in result.review_bindings:
        assert isinstance(binding, ReviewBinding)
        assert binding.artifact_id in ids
        assert binding.coverage in ("complete", "partial", "none")
        if isinstance(binding.projection, PageProjection):
            page = result.pages[binding.projection.page_index]
            text = getattr(
                page,
                {
                    "markdown": "markdown",
                    "headerMarkdown": "header_markdown",
                    "footerMarkdown": "footer_markdown",
                }[binding.projection.field],
            )
        else:
            assert isinstance(binding.projection, DocumentProjection)
            text = result.markdown
        for span in binding.ranges:
            assert 0 <= span.start <= span.end
            assert span.end <= len(text.encode("utf-16-le")) // 2
            assert span.unit == "utf16-code-unit"
    complete = [b for b in result.review_bindings if b.coverage == "complete"]
    assert complete, "at least one artifact maps exactly into the Markdown"


def test_font_and_pagination_records(reviewed_document):
    result = convert(reviewed_document, display_mode="proposed")
    assert isinstance(result.font_resolution, FontResolution)
    assert result.font_resolution.default_family
    assert isinstance(result.pagination, Pagination)
    assert result.pagination.display_mode == "proposed"
    assert result.pagination.layout_revision >= 0


def test_records_tolerate_missing_optional_fields():
    assert Comment.from_json({"id": "c1", "author": "A"}).occurrences == []
    change = TrackedChange.from_json({"id": "t1", "change": "bogus"})
    assert change.change == "structural" and change.date is None
    assert ReviewBinding.from_json({}).coverage == "none"
    assert isinstance(ReviewBinding.from_json({}).projection, DocumentProjection)
