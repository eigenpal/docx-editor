export type RibbonContextKey = 'table' | 'headerFooter' | 'image';

export type RibbonItemType = 'button' | 'component';

export type RibbonItemSize = 'small' | 'medium' | 'large';

export type RibbonButtonItem = {
  id: string;
  type: 'button';
  label: string;
  icon?: string;
  actionId?: string;
  showLabel?: boolean;
  allowInReadOnly?: boolean;
  size?: RibbonItemSize;
};

export type RibbonComponentId =
  | 'fontFamily'
  | 'fontSize'
  | 'textColor'
  | 'highlightColor'
  | 'stylePicker'
  | 'listButtons'
  | 'alignmentButtons'
  | 'lineSpacing'
  | 'tableGrid'
  | 'tableBorderPicker'
  | 'tableBorderColor'
  | 'tableBorderWidth'
  | 'tableCellFill'
  | 'tableStyleGallery'
  | 'zoomControl'
  | 'editingMode';

export type RibbonComponentItem = {
  id: string;
  type: 'component';
  component: RibbonComponentId;
  size?: RibbonItemSize;
};

export type RibbonItem = RibbonButtonItem | RibbonComponentItem;

export type RibbonGroup = {
  id: string;
  label: string;
  items: RibbonItem[];
};

export type RibbonTab = {
  id: string;
  label: string;
  groups: RibbonGroup[];
  when?: RibbonContextKey;
};

const button = (
  id: string,
  label: string,
  icon?: string,
  actionId?: string,
  options?: { showLabel?: boolean; allowInReadOnly?: boolean; size?: RibbonItemSize }
): RibbonButtonItem => ({
  id,
  type: 'button',
  label,
  icon,
  actionId,
  showLabel: options?.showLabel,
  allowInReadOnly: options?.allowInReadOnly,
  size: options?.size,
});

const component = (
  id: string,
  componentId: RibbonComponentId,
  options?: { size?: RibbonItemSize }
): RibbonComponentItem => ({
  id,
  type: 'component',
  component: componentId,
  size: options?.size,
});

export const ribbonConfig: { tabs: RibbonTab[] } = {
  tabs: [
    {
      id: 'home',
      label: 'Home',
      groups: [
        {
          id: 'history',
          label: 'History',
          items: [
            button('undo', 'Undo', 'undo', 'undo', { showLabel: true, allowInReadOnly: false }),
            button('redo', 'Redo', 'redo', 'redo', { showLabel: true, allowInReadOnly: false }),
          ],
        },
        {
          id: 'clipboard',
          label: 'Clipboard',
          items: [
            button('cut', 'Cut', 'cut', 'cut', { showLabel: true }),
            button('copy', 'Copy', 'copy', 'copy', { showLabel: true, allowInReadOnly: true }),
            button('paste', 'Paste', 'paste', 'paste', { showLabel: true, size: 'large' }),
            button('localClipboard', 'Local Clipboard', 'clipboard', 'localClipboard', {
              showLabel: true,
            }),
          ],
        },
        {
          id: 'font',
          label: 'Font',
          items: [
            component('fontFamily', 'fontFamily'),
            component('fontSize', 'fontSize'),
            button('fontGrow', 'Grow Font', 'fontGrow', 'fontGrow'),
            button('fontShrink', 'Shrink Font', 'fontShrink', 'fontShrink'),
            button('bold', 'Bold', 'bold', 'bold'),
            button('italic', 'Italic', 'italic', 'italic'),
            button('underline', 'Underline', 'underline', 'underline'),
            button('strikethrough', 'Strikethrough', 'strikethrough', 'strikethrough'),
            button('superscript', 'Superscript', 'superscript', 'superscript'),
            button('subscript', 'Subscript', 'subscript', 'subscript'),
            component('textColor', 'textColor'),
            component('highlightColor', 'highlightColor'),
            button('clearFormatting', 'Clear Formatting', 'clearFormatting', 'clearFormatting'),
          ],
        },
        {
          id: 'paragraph',
          label: 'Paragraph',
          items: [
            component('listButtons', 'listButtons'),
            button('showMarks', 'Show/Hide Marks', 'showMarks', 'showMarks'),
            component('alignmentButtons', 'alignmentButtons'),
            component('lineSpacing', 'lineSpacing'),
            button('ltrText', 'Left-to-Right', 'ltr', 'setLtr'),
            button('rtlText', 'Right-to-Left', 'rtl', 'setRtl'),
            button('borders', 'Borders', 'borders', 'borders'),
          ],
        },
        {
          id: 'styles',
          label: 'Styles',
          items: [component('stylePicker', 'stylePicker', { size: 'large' })],
        },
        {
          id: 'find',
          label: 'Find',
          items: [
            button('find', 'Find', 'find', 'find', { allowInReadOnly: true }),
            button('replace', 'Replace', 'replace', 'replace'),
          ],
        },
      ],
    },
    {
      id: 'insert',
      label: 'Insert',
      groups: [
        {
          id: 'pages',
          label: 'Pages',
          items: [button('pageBreak', 'Page Break', 'pageBreak', 'pageBreak')],
        },
        {
          id: 'table',
          label: 'Table',
          items: [component('tableGrid', 'tableGrid', { size: 'large' })],
        },
        {
          id: 'illustrations',
          label: 'Illustrations',
          items: [button('image', 'Image', 'image', 'insertImage')],
        },
        {
          id: 'links',
          label: 'Links',
          items: [button('link', 'Link', 'link', 'insertLink')],
        },
        {
          id: 'toc',
          label: 'Table of Contents',
          items: [button('tableOfContents', 'Table of Contents', 'toc', 'insertTOC')],
        },
        {
          id: 'bookmarks',
          label: 'Bookmarks',
          items: [button('bookmark', 'Bookmark', 'bookmark', 'bookmark')],
        },
        {
          id: 'comments',
          label: 'Comments',
          items: [button('newComment', 'New Comment', 'newComment', 'newComment')],
        },
        {
          id: 'headerFooter',
          label: 'Header & Footer',
          items: [
            button('insertHeader', 'Header', 'header', 'openHeader'),
            button('insertFooter', 'Footer', 'footer', 'openFooter'),
            button('pageNumber', 'Page Number', 'pageNumber', 'pageNumber'),
          ],
        },
      ],
    },
    {
      id: 'layout',
      label: 'Layout',
      groups: [
        {
          id: 'pageSetup',
          label: 'Page Setup',
          items: [
            button('pageSetup', 'Page Setup', 'pageSetup', 'pageSetup'),
            button('margins', 'Margins', 'margins', 'margins'),
            button('orientation', 'Orientation', 'orientation', 'orientation'),
            button('size', 'Size', 'size', 'size'),
            button('columns', 'Columns', 'columns', 'columns'),
            button('breaks', 'Breaks', 'breaks', 'breaks'),
          ],
        },
        {
          id: 'layoutParagraph',
          label: 'Paragraph',
          items: [
            button('indentLeft', 'Indent Left', 'indentLeft', 'indentLeft'),
            button('indentRight', 'Indent Right', 'indentRight', 'indentRight'),
            button('spacingBefore', 'Spacing Before', 'spacingBefore', 'spacingBefore'),
            button('spacingAfter', 'Spacing After', 'spacingAfter', 'spacingAfter'),
          ],
        },
      ],
    },
    {
      id: 'review',
      label: 'Review',
      groups: [
        {
          id: 'reviewComments',
          label: 'Comments',
          items: [
            button('reviewNewComment', 'New Comment', 'newComment', 'newComment'),
            button('reviewPrevious', 'Previous', 'previous', 'previousComment'),
            button('reviewNext', 'Next', 'next', 'nextComment'),
            button('reviewShowComments', 'Show Comments', 'showComments', 'toggleComments', {
              allowInReadOnly: true,
            }),
            button('reviewDelete', 'Delete', 'delete', 'deleteComment'),
          ],
        },
        {
          id: 'tracking',
          label: 'Tracking',
          items: [
            component('editingMode', 'editingMode'),
            button('trackChanges', 'Track Changes', 'trackChanges', 'trackChanges'),
            button('acceptAll', 'Accept All', 'acceptAll', 'acceptAllChanges'),
            button('rejectAll', 'Reject All', 'rejectAll', 'rejectAllChanges'),
          ],
        },
        {
          id: 'protect',
          label: 'Protect',
          items: [button('protectDoc', 'Protect Document', 'protect', 'protectDocument')],
        },
      ],
    },
    {
      id: 'view',
      label: 'View',
      groups: [
        {
          id: 'views',
          label: 'Views',
          items: [
            button('readOnly', 'Read Only', 'readOnly', 'readOnly', { allowInReadOnly: true }),
            button('printLayout', 'Print Layout', 'printLayout', 'printLayout', {
              allowInReadOnly: true,
            }),
            button('webLayout', 'Web Layout', 'webLayout', 'webLayout', {
              allowInReadOnly: true,
            }),
          ],
        },
        {
          id: 'zoom',
          label: 'Zoom',
          items: [
            button('zoomIn', 'Zoom In', 'zoomIn', 'zoomIn', { allowInReadOnly: true }),
            button('zoomOut', 'Zoom Out', 'zoomOut', 'zoomOut', { allowInReadOnly: true }),
            button('zoom100', '100%', 'zoom100', 'zoom100', { allowInReadOnly: true }),
            button('zoomOnePage', 'One Page', 'onePage', 'zoomOnePage', {
              allowInReadOnly: true,
            }),
            button('zoomPageWidth', 'Page Width', 'pageWidth', 'zoomPageWidth', {
              allowInReadOnly: true,
            }),
          ],
        },
        {
          id: 'show',
          label: 'Show',
          items: [
            button('showRuler', 'Ruler', 'ruler', 'toggleRuler', { allowInReadOnly: true }),
            button('showBookmarks', 'Show Bookmarks', 'showBookmarks', 'showBookmarks', {
              allowInReadOnly: true,
            }),
            button('navigationPane', 'Navigation Pane', 'navigationPane', 'toggleNavigationPane', {
              allowInReadOnly: true,
            }),
          ],
        },
      ],
    },
    {
      id: 'references',
      label: 'References',
      groups: [
        {
          id: 'referencesToc',
          label: 'Table of Contents',
          items: [
            button('refToc', 'Table of Contents', 'toc', 'insertTOC'),
            button('updateTable', 'Update Table', 'updateTable', 'updateTOC'),
          ],
        },
        {
          id: 'footnotes',
          label: 'Footnotes',
          items: [
            button('insertFootnote', 'Insert Footnote', 'footnote', 'insertFootnote'),
            button('insertEndnote', 'Insert Endnote', 'endnote', 'insertEndnote'),
          ],
        },
      ],
    },
    {
      id: 'developer',
      label: 'Developer',
      groups: [
        {
          id: 'formFields',
          label: 'Form Fields',
          items: [button('formFields', 'Form Fields', 'formFields', 'formFields')],
        },
        {
          id: 'controls',
          label: 'Controls',
          items: [button('contentControl', 'Content Control', 'contentControl', 'contentControl')],
        },
        {
          id: 'mapping',
          label: 'Mapping',
          items: [button('xmlMapping', 'XML Mapping Pane', 'xmlMapping', 'xmlMapping')],
        },
        {
          id: 'developerProtect',
          label: 'Protect',
          items: [
            button('restrictEditing', 'Restrict Editing', 'restrictEditing', 'restrictEditing'),
          ],
        },
      ],
    },
    {
      id: 'tableDesign',
      label: 'Table Design',
      when: 'table',
      groups: [
        {
          id: 'tableStyles',
          label: 'Table Styles',
          items: [component('tableStyleGallery', 'tableStyleGallery', { size: 'large' })],
        },
        {
          id: 'tableBorders',
          label: 'Borders',
          items: [
            button('borderAll', 'All Borders', 'borderAll', 'borderAll'),
            button('borderOutside', 'Outside Borders', 'borderOutside', 'borderOutside'),
            button('borderInside', 'Inside Borders', 'borderInside', 'borderInside'),
            button('borderNone', 'No Border', 'borderNone', 'borderNone'),
            component('tableBorderColor', 'tableBorderColor'),
            component('tableBorderWidth', 'tableBorderWidth'),
          ],
        },
        {
          id: 'tableShading',
          label: 'Shading',
          items: [component('tableCellFill', 'tableCellFill')],
        },
        {
          id: 'tableOptions',
          label: 'Options',
          items: [button('toggleHeaderRow', 'Header Row', 'headerRow', 'toggleHeaderRow')],
        },
      ],
    },
    {
      id: 'tableLayout',
      label: 'Table Layout',
      when: 'table',
      groups: [
        {
          id: 'rowsColumns',
          label: 'Rows & Columns',
          items: [
            button('insertRowAbove', 'Insert Above', 'addRowAbove', 'addRowAbove'),
            button('insertRowBelow', 'Insert Below', 'addRowBelow', 'addRowBelow'),
            button('insertColumnLeft', 'Insert Left', 'addColumnLeft', 'addColumnLeft'),
            button('insertColumnRight', 'Insert Right', 'addColumnRight', 'addColumnRight'),
          ],
        },
        {
          id: 'merge',
          label: 'Merge',
          items: [
            button('mergeCells', 'Merge Cells', 'mergeCells', 'mergeCells'),
            button('splitCells', 'Split Cells', 'splitCells', 'splitCells'),
          ],
        },
        {
          id: 'cellSize',
          label: 'Cell Size',
          items: [
            button(
              'distributeColumns',
              'Distribute Columns',
              'distributeColumns',
              'distributeColumns'
            ),
            button('autoFit', 'AutoFit Contents', 'autoFit', 'autoFitContents'),
          ],
        },
        {
          id: 'alignment',
          label: 'Alignment',
          items: [
            button('alignTop', 'Align Top', 'alignTop', 'alignTop'),
            button('alignCenter', 'Align Center', 'alignCenter', 'alignCenter'),
            button('alignBottom', 'Align Bottom', 'alignBottom', 'alignBottom'),
          ],
        },
        {
          id: 'delete',
          label: 'Delete',
          items: [
            button('deleteRow', 'Delete Row', 'deleteRow', 'deleteRow'),
            button('deleteColumn', 'Delete Column', 'deleteColumn', 'deleteColumn'),
            button('deleteTable', 'Delete Table', 'deleteTable', 'deleteTable'),
          ],
        },
        {
          id: 'properties',
          label: 'Properties',
          items: [
            button('tableProperties', 'Table Properties', 'tableProperties', 'tableProperties'),
          ],
        },
      ],
    },
    {
      id: 'headerFooter',
      label: 'Header & Footer',
      when: 'headerFooter',
      groups: [
        {
          id: 'hfEdit',
          label: 'Header & Footer',
          items: [
            button('hfHeader', 'Header', 'header', 'openHeader'),
            button('hfFooter', 'Footer', 'footer', 'openFooter'),
            button('hfClose', 'Close', 'close', 'closeHeaderFooter', { allowInReadOnly: true }),
          ],
        },
        {
          id: 'hfNumbers',
          label: 'Page Numbers',
          items: [button('hfPageNumber', 'Page Number', 'pageNumber', 'pageNumber')],
        },
      ],
    },
    {
      id: 'pictureFormat',
      label: 'Picture Format',
      when: 'image',
      groups: [
        {
          id: 'pictureSize',
          label: 'Size',
          items: [
            button('imageWidth', 'Width', 'imageWidth', 'imageWidth'),
            button('imageHeight', 'Height', 'imageHeight', 'imageHeight'),
            button('aspectRatio', 'Aspect Ratio', 'aspectRatio', 'aspectRatio'),
          ],
        },
        {
          id: 'pictureAccessibility',
          label: 'Accessibility',
          items: [button('altText', 'Alt Text', 'altText', 'imageAltText')],
        },
      ],
    },
  ],
};
