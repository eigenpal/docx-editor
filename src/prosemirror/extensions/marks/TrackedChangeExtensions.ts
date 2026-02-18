/**
 * Tracked Change Mark Extensions — insertion, deletion, and move marks
 *
 * Renders insertions with green underline and deletions with red strikethrough,
 * matching the standard MS Word display for tracked changes.
 */

import { createMarkExtension } from '../create';

/**
 * Insertion mark — text added in tracked changes
 * Renders with green color and underline.
 */
export const InsertionExtension = createMarkExtension({
  name: 'insertion',
  schemaMarkName: 'insertion',
  markSpec: {
    attrs: {
      revisionId: { default: 0 },
      author: { default: '' },
      date: { default: null },
      rangeId: { default: null },
      rangeName: { default: null },
      rangeAuthor: { default: null },
      rangeDate: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span.docx-insertion',
        getAttrs(dom) {
          const el = dom as HTMLElement;
          return {
            revisionId: parseInt(el.dataset.revisionId || '0', 10),
            author: el.dataset.author || '',
            date: el.dataset.date || null,
            rangeId: el.dataset.rangeId ? parseInt(el.dataset.rangeId, 10) : null,
            rangeName: el.dataset.rangeName || null,
            rangeAuthor: el.dataset.rangeAuthor || null,
            rangeDate: el.dataset.rangeDate || null,
          };
        },
      },
    ],
    toDOM(mark) {
      return [
        'span',
        {
          class: 'docx-insertion',
          'data-revision-id': String(mark.attrs.revisionId),
          'data-author': mark.attrs.author,
          ...(mark.attrs.date ? { 'data-date': mark.attrs.date } : {}),
          ...(mark.attrs.rangeId != null ? { 'data-range-id': String(mark.attrs.rangeId) } : {}),
          ...(mark.attrs.rangeName ? { 'data-range-name': mark.attrs.rangeName } : {}),
          ...(mark.attrs.rangeAuthor ? { 'data-range-author': mark.attrs.rangeAuthor } : {}),
          ...(mark.attrs.rangeDate ? { 'data-range-date': mark.attrs.rangeDate } : {}),
          style: 'color: #2e7d32; text-decoration: underline; text-decoration-color: #2e7d32;',
        },
        0,
      ];
    },
  },
});

/**
 * Deletion mark — text removed in tracked changes
 * Renders with red color and strikethrough.
 */
export const DeletionExtension = createMarkExtension({
  name: 'deletion',
  schemaMarkName: 'deletion',
  markSpec: {
    attrs: {
      revisionId: { default: 0 },
      author: { default: '' },
      date: { default: null },
      rangeId: { default: null },
      rangeName: { default: null },
      rangeAuthor: { default: null },
      rangeDate: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span.docx-deletion',
        getAttrs(dom) {
          const el = dom as HTMLElement;
          return {
            revisionId: parseInt(el.dataset.revisionId || '0', 10),
            author: el.dataset.author || '',
            date: el.dataset.date || null,
            rangeId: el.dataset.rangeId ? parseInt(el.dataset.rangeId, 10) : null,
            rangeName: el.dataset.rangeName || null,
            rangeAuthor: el.dataset.rangeAuthor || null,
            rangeDate: el.dataset.rangeDate || null,
          };
        },
      },
    ],
    toDOM(mark) {
      return [
        'span',
        {
          class: 'docx-deletion',
          'data-revision-id': String(mark.attrs.revisionId),
          'data-author': mark.attrs.author,
          ...(mark.attrs.date ? { 'data-date': mark.attrs.date } : {}),
          ...(mark.attrs.rangeId != null ? { 'data-range-id': String(mark.attrs.rangeId) } : {}),
          ...(mark.attrs.rangeName ? { 'data-range-name': mark.attrs.rangeName } : {}),
          ...(mark.attrs.rangeAuthor ? { 'data-range-author': mark.attrs.rangeAuthor } : {}),
          ...(mark.attrs.rangeDate ? { 'data-range-date': mark.attrs.rangeDate } : {}),
          style: 'color: #c62828; text-decoration: line-through; text-decoration-color: #c62828;',
        },
        0,
      ];
    },
  },
});

/**
 * Move-from mark — text moved out of this location.
 */
export const MoveFromExtension = createMarkExtension({
  name: 'moveFrom',
  schemaMarkName: 'moveFrom',
  markSpec: {
    attrs: {
      revisionId: { default: 0 },
      author: { default: '' },
      date: { default: null },
      rangeId: { default: null },
      rangeName: { default: null },
      rangeAuthor: { default: null },
      rangeDate: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span.docx-move-from',
        getAttrs(dom) {
          const el = dom as HTMLElement;
          return {
            revisionId: parseInt(el.dataset.revisionId || '0', 10),
            author: el.dataset.author || '',
            date: el.dataset.date || null,
            rangeId: el.dataset.rangeId ? parseInt(el.dataset.rangeId, 10) : null,
            rangeName: el.dataset.rangeName || null,
            rangeAuthor: el.dataset.rangeAuthor || null,
            rangeDate: el.dataset.rangeDate || null,
          };
        },
      },
    ],
    toDOM(mark) {
      return [
        'span',
        {
          class: 'docx-move-from',
          'data-revision-id': String(mark.attrs.revisionId),
          'data-author': mark.attrs.author,
          ...(mark.attrs.date ? { 'data-date': mark.attrs.date } : {}),
          ...(mark.attrs.rangeId != null ? { 'data-range-id': String(mark.attrs.rangeId) } : {}),
          ...(mark.attrs.rangeName ? { 'data-range-name': mark.attrs.rangeName } : {}),
          ...(mark.attrs.rangeAuthor ? { 'data-range-author': mark.attrs.rangeAuthor } : {}),
          ...(mark.attrs.rangeDate ? { 'data-range-date': mark.attrs.rangeDate } : {}),
          style: 'color: #c62828; text-decoration: line-through; text-decoration-color: #c62828;',
        },
        0,
      ];
    },
  },
});

/**
 * Move-to mark — text moved into this location.
 */
export const MoveToExtension = createMarkExtension({
  name: 'moveTo',
  schemaMarkName: 'moveTo',
  markSpec: {
    attrs: {
      revisionId: { default: 0 },
      author: { default: '' },
      date: { default: null },
      rangeId: { default: null },
      rangeName: { default: null },
      rangeAuthor: { default: null },
      rangeDate: { default: null },
    },
    inclusive: false,
    parseDOM: [
      {
        tag: 'span.docx-move-to',
        getAttrs(dom) {
          const el = dom as HTMLElement;
          return {
            revisionId: parseInt(el.dataset.revisionId || '0', 10),
            author: el.dataset.author || '',
            date: el.dataset.date || null,
            rangeId: el.dataset.rangeId ? parseInt(el.dataset.rangeId, 10) : null,
            rangeName: el.dataset.rangeName || null,
            rangeAuthor: el.dataset.rangeAuthor || null,
            rangeDate: el.dataset.rangeDate || null,
          };
        },
      },
    ],
    toDOM(mark) {
      return [
        'span',
        {
          class: 'docx-move-to',
          'data-revision-id': String(mark.attrs.revisionId),
          'data-author': mark.attrs.author,
          ...(mark.attrs.date ? { 'data-date': mark.attrs.date } : {}),
          ...(mark.attrs.rangeId != null ? { 'data-range-id': String(mark.attrs.rangeId) } : {}),
          ...(mark.attrs.rangeName ? { 'data-range-name': mark.attrs.rangeName } : {}),
          ...(mark.attrs.rangeAuthor ? { 'data-range-author': mark.attrs.rangeAuthor } : {}),
          ...(mark.attrs.rangeDate ? { 'data-range-date': mark.attrs.rangeDate } : {}),
          style: 'color: #2e7d32; text-decoration: underline; text-decoration-color: #2e7d32;',
        },
        0,
      ];
    },
  },
});
