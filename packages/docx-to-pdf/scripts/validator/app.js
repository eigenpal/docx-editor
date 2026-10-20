/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
const $ = (selector) => document.querySelector(selector);
const state = {
  catalog: null,
  document: null,
  page: 1,
  request: 0,
  showDiff: false,
  diffMode: 'diff',
  zoom: 'fit',
};
const initial = new URLSearchParams(location.hash.slice(1));
let selectedId = initial.get('document');
let selectedPair = initial.get('pair') || 'reference-a--ours';
const label = (key) => state.catalog?.labels?.[key] || key;
const percent = (value) => (Number.isFinite(value) ? `${value.toFixed(2)}%` : '—');
const asset = (path) => '/assets/' + path.split('/').map(encodeURIComponent).join('/');
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function option(value, text) {
  const node = element('option', text);
  node.value = value;
  return node;
}
function notice(message) {
  $('#notice').textContent = message;
  $('#notice').hidden = !message;
}
async function get(path) {
  const response = await fetch(path);
  if (!response.ok)
    throw new Error(
      `Cannot load evidence (${response.status}). Refresh after generation finishes.`
    );
  return response.json();
}
function updateHash() {
  const params = new URLSearchParams({
    document: selectedId || '',
    pair: selectedPair,
    page: String(state.page),
    scope: $('#scope').value,
  });
  history.replaceState(null, '', '#' + params);
}
async function refresh() {
  const [catalog, worker] = await Promise.all([get('/api/catalog'), get('/api/state')]);
  const changed = JSON.stringify(catalog) !== JSON.stringify(state.catalog);
  state.catalog = catalog;
  $('#worker').textContent =
    worker.status === 'running'
      ? `Generating ${worker.current} · ${worker.stage || 'starting'} · ${worker.queue.length} queued`
      : worker.status === 'idle'
        ? 'Ready for DOCX files · serial worker'
        : worker.message || worker.status;
  $('#inbox').textContent = worker.inbox;
  $('#inbox').title = worker.inbox;
  const serverNotice = catalog.warnings.length
    ? catalog.warnings.join('\n')
    : worker.lastError
      ? `${worker.lastError.file}: ${worker.lastError.error}`
      : '';
  if (serverNotice) notice(serverNotice);
  else if (state.lastServerNotice && $('#notice').textContent === state.lastServerNotice)
    notice('');
  state.lastServerNotice = serverNotice;
  if (!changed) return;
  const pairs = [
    ...new Set(catalog.documents.flatMap((doc) => Object.keys(doc.comparisons))),
  ].sort();
  $('#pair').replaceChildren(
    ...pairs.map((pair) => {
      const [left, right] = pair.split('--');
      return option(pair, `${label(left)} vs ${label(right)}`);
    })
  );
  if (!pairs.includes(selectedPair)) selectedPair = pairs[0] || '';
  $('#pair').value = selectedPair;
  renderList();
  if (selectedId) await selectDocument(selectedId, false);
}
function inScope(doc) {
  const scope = $('#scope').value;
  return scope === 'all' || (scope === 'diagnostic' ? Boolean(doc.diagnostic) : !doc.diagnostic);
}
function filteredDocuments() {
  const query = $('#search').value.toLowerCase();
  const filter = $('#filter').value;
  const docs = state.catalog.documents.filter((doc) => {
    const comparison = doc.comparisons[selectedPair];
    return (
      inScope(doc) &&
      doc.name.toLowerCase().includes(query) &&
      (filter === 'all' ||
        filter === comparison?.verdict ||
        (filter === 'mismatch' && comparison?.pageCountMismatch) ||
        (filter === 'unscored' && (!comparison || doc.status !== 'exported')) ||
        (filter === 'fonts' && doc.fonts?.length))
    );
  });
  return docs.sort((a, b) => {
    if ($('#sort').value === 'name') return a.name.localeCompare(b.name);
    const left = a.comparisons[selectedPair],
      right = b.comparisons[selectedPair];
    if ($('#sort').value === 'early') {
      const page =
        (left?.firstDivergence?.page ?? Infinity) - (right?.firstDivergence?.page ?? Infinity);
      if (page && Number.isFinite(page)) return page;
      if (left?.firstDivergence && !right?.firstDivergence) return -1;
      if (!left?.firstDivergence && right?.firstDivergence) return 1;
    }
    return (right?.errorPercent ?? -1) - (left?.errorPercent ?? -1) || a.name.localeCompare(b.name);
  });
}
function renderList() {
  if (!state.catalog) return;
  const docs = filteredDocuments();
  const compared = state.catalog.documents.filter(
    (doc) => !doc.diagnostic && doc.comparisons[selectedPair]
  );
  const passed = compared.filter((doc) => doc.comparisons[selectedPair].verdict === 'pass');
  $('#counts').textContent =
    `${docs.length} shown · ${compared.length} originals scored · ${passed.length} originals pass <1%`;
  $('#documents').replaceChildren(
    ...docs.map((doc) => {
      const comparison = doc.comparisons[selectedPair];
      const button = element('button', undefined, 'doc');
      button.setAttribute('aria-current', String(doc.id === selectedId));
      button.append(element('div', doc.name.replace(/\.docx$/i, ''), 'doc-name'));
      const bottom = element('div', undefined, 'doc-bottom');
      bottom.append(
        element(
          'span',
          comparison?.pageCountMismatch
            ? 'Page count differs'
            : comparison?.firstDivergence
              ? `First drift · p${comparison.firstDivergence.page}`
              : comparison
                ? 'No flagged page'
                : doc.status !== 'exported'
                  ? doc.status
                  : 'No reference'
        )
      );
      bottom.append(
        element(
          'span',
          comparison ? percent(comparison.errorPercent) : '—',
          comparison?.verdict === 'pass' ? 'pass' : 'error'
        )
      );
      button.append(bottom);
      button.addEventListener('click', () => selectDocument(doc.id));
      return button;
    })
  );
  if (!docs.length) $('#documents').append(element('p', 'No matching documents.', 'empty'));
  if (!docs.some((doc) => doc.id === selectedId)) {
    selectedId = docs[0]?.id || null;
    if (selectedId) selectDocument(selectedId);
    else {
      state.request++;
      state.document = null;
      $('#main').replaceChildren(
        element('div', 'Add a DOCX or change the filters to begin.', 'empty')
      );
    }
  }
}
async function selectDocument(id, reset = true) {
  selectedId = id;
  const request = ++state.request;
  try {
    const doc = await get('/api/documents/' + id);
    if (request !== state.request) return;
    const newSelection = state.document?.id !== id;
    state.document = doc;
    const comparison = doc.comparisons[selectedPair];
    if (reset || newSelection) state.page = comparison?.firstDivergence?.page || 1;
    if (initial.has('page') && initial.get('document') === id) {
      state.page = Math.trunc(Number(initial.get('page'))) || 1;
      initial.delete('page');
    }
    renderDetail();
    for (const button of $('#documents').children) button.setAttribute('aria-current', 'false');
    // Re-rendering the list also updates the selected marker after a refresh.
    renderList();
    updateHash();
  } catch (error) {
    if (request === state.request) notice(error.message);
  }
}
function link(text, path) {
  const anchor = element('a', text);
  anchor.href = path;
  anchor.target = '_blank';
  anchor.rel = 'noopener';
  return anchor;
}
function metric(title, value, note) {
  const box = element('div', undefined, 'metric');
  box.append(
    element('div', title, 'metric-label'),
    element('div', value, 'metric-value'),
    element('div', note, 'metric-note')
  );
  return box;
}
function renderDetail() {
  const doc = state.document;
  const comparison = doc.comparisons[selectedPair];
  $('#main').replaceChildren($('#detail').content.cloneNode(true));
  $('h2').textContent = doc.name;
  const verdict = comparison?.verdict || 'unscored';
  $('.verdict').textContent = doc.diagnostic
    ? 'FONT DIAGNOSTIC'
    : verdict === 'pass'
      ? 'PASS <1%'
      : verdict === 'fail'
        ? 'NEEDS REVIEW'
        : 'UNSCORED';
  $('.verdict').classList.add(verdict);
  if (doc.source) $('.links').append(link('Source DOCX ↗', asset(doc.source)));
  for (const [key, pdf] of Object.entries(doc.pdfs || {}))
    $('.links').append(link(`${label(key)} PDF ↗`, asset(pdf.path)));
  $('.links').append(link('Evidence JSON ↗', '/api/documents/' + doc.id));
  $('.diagnostics').textContent = JSON.stringify(
    {
      status: doc.status,
      message: doc.message,
      diagnostic: doc.diagnostic,
      fontResolution: doc.fontResolution,
      fontSubstitutions: doc.fonts,
      referenceFailures: doc.referenceFailures,
      sourceSha256: doc.sourceSha256,
      engineSha256: doc.engineSha256,
      resources: doc.resources,
      diagnostics: doc.diagnostics,
    },
    null,
    2
  );
  if (!comparison) {
    $('.finding').textContent =
      doc.message ||
      doc.referenceFailures?.[selectedPair.split('--')[0]] ||
      'No comparison for this pair. Select another reference or add a captured reference.';
    $('.metrics').remove();
    $('.review-controls').remove();
    $('.page-strip').remove();
    $('.page-meta').remove();
    $('.preview-scroll').remove();
    return;
  }
  const first = comparison.firstDivergence;
  $('.metrics').append(
    metric(
      'PIXEL SIMILARITY',
      percent(comparison.similarity),
      `${percent(comparison.errorPercent)} changed · target <1%`
    ),
    metric(
      'PAGES',
      `${comparison.leftPages} / ${comparison.rightPages}`,
      `${label(comparison.left)} / ${label(comparison.right)}`
    ),
    metric(
      'FIRST DIVERGENCE',
      first ? `Page ${first.page}` : 'None',
      first
        ? `First changed region starts at ${first.topPt.toFixed(1)} pt`
        : 'No page reaches the 0.1% trigger'
    ),
    metric(
      'TEXT MOVEMENT',
      comparison.movementSeverity,
      `${comparison.text.missing ?? '—'} unmatched reference · ${comparison.text.crossPage ?? '—'} cross-page`
    )
  );
  $('.finding').textContent = first
    ? `Start with page ${first.page}, from the top${first.page > 1 ? `, and check the end of page ${first.page - 1}` : ''}. Later-page errors may be accumulated drift. ${comparison.reasons.join('. ')}${doc.fonts?.length ? ` · Font substitutions: ${doc.fonts.join(', ')}` : ''}`
    : `No early drift flagged. ${comparison.reasons.join('. ') || 'The measured comparison passes the current target.'}`;
  if (doc.diagnostic) {
    $('.finding').textContent =
      `Shared-font experiment: ${doc.diagnostic.family}. Excluded from the original-document goal. Verify font coverage and substitutions in every renderer. ` +
      $('.finding').textContent;
    $('.links').append(
      link(
        'Original evidence ↗',
        '/#' + new URLSearchParams({ document: doc.diagnostic.originalSha256, pair: selectedPair })
      )
    );
  }
  $('#page').replaceChildren(
    ...comparison.pages.map((page) => option(String(page.number), String(page.number)))
  );
  $('#page').onchange = () => {
    state.page = Number($('#page').value);
    renderPage();
  };
  $('#first').onclick = () => {
    state.page = first?.page || 1;
    renderPage();
  };
  $('#worst').onclick = () => {
    state.page = comparison.pages.reduce((a, b) =>
      a.errorPercent >= b.errorPercent ? a : b
    ).number;
    renderPage();
  };
  $('#show-diff').checked = state.showDiff;
  $('#show-diff').onchange = () => {
    state.showDiff = $('#show-diff').checked;
    renderPage();
  };
  $('#diff-mode').value = state.diffMode;
  $('#diff-mode').onchange = () => {
    state.diffMode = $('#diff-mode').value;
    renderPage();
  };
  $('#zoom').value = state.zoom;
  $('#zoom').onchange = () => {
    state.zoom = $('#zoom').value;
    renderPage();
  };
  $('.page-strip').replaceChildren(
    ...comparison.pages.map((page) => {
      const button = element('button', `Page ${page.number}`, 'page-chip');
      button.append(
        element('span', percent(page.errorPercent), page.errorPercent >= 1 ? 'error' : 'pass')
      );
      button.onclick = () => {
        state.page = page.number;
        renderPage();
      };
      return button;
    })
  );
  renderPage();
}
function renderPage() {
  const comparison = state.document.comparisons[selectedPair];
  state.page = Math.max(1, Math.min(state.page, comparison.pages.length));
  const page = comparison.pages[state.page - 1];
  $('#page').value = String(state.page);
  $('#diff-mode').disabled = !state.showDiff;
  for (const [i, chip] of [...$('.page-strip').children].entries())
    chip.setAttribute('aria-current', String(i + 1 === state.page));
  $('.page-meta').replaceChildren(
    element(
      'span',
      `Page ${state.page} · ${percent(page.errorPercent)} changed${page.sizeMismatch ? ' · dimensions differ' : ''}`
    ),
    element('span', `${comparison.dpi} DPI · pixel threshold ${comparison.threshold} / 255`)
  );
  const drift = comparison.text.pageDrift?.find((entry) => entry.page === state.page);
  if (drift)
    $('.page-meta').firstChild.textContent +=
      ` · text ΔY top ${drift.topThirdDeltaYPt.toFixed(1)} → bottom ${drift.bottomThirdDeltaYPt.toFixed(1)} pt`;
  const previews = $('.previews');
  previews.className = 'previews' + (state.zoom === 'fit' ? '' : ` zoom${state.zoom}`);
  const roles = ['left', 'right', ...(state.showDiff ? [state.diffMode] : [])];
  previews.replaceChildren(
    ...roles.map((role) => {
      const figure = element('figure');
      const title =
        role === 'left'
          ? label(comparison.left)
          : role === 'right'
            ? label(comparison.right)
            : role === 'diff'
              ? 'Difference · amplified ×8'
              : 'Difference · red overlay';
      figure.append(element('figcaption', title));
      if ((role === 'left' && !page.leftPresent) || (role === 'right' && !page.rightPresent)) {
        figure.append(element('div', 'No corresponding page', 'missing'));
      } else {
        const image = element('img');
        image.src = asset(page.images[role]);
        image.alt = `${title}, page ${state.page}`;
        image.onerror = () => {
          image.replaceWith(
            element('div', 'Preview unavailable. Refresh after generation completes.', 'missing')
          );
        };
        figure.append(image);
      }
      return figure;
    })
  );
  $('.preview-scroll').scrollTop = 0;
  $('.regions').replaceChildren(
    ...page.bands.map(([top, bottom]) => {
      const button = element('button', `${top.toFixed(1)}–${bottom.toFixed(1)} pt`);
      button.title = 'Jump to this changed region';
      button.onclick = () => {
        const image = $('.previews img');
        if (image?.naturalWidth)
          $('.preview-scroll').scrollTop = Math.max(
            0,
            (((top * comparison.dpi) / 72) * image.clientWidth) / image.naturalWidth - 30
          );
      };
      return button;
    })
  );
  updateHash();
}
async function upload(files) {
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith('.docx') || file.size > 20 * 1024 * 1024) {
      notice(`${file.name}: choose a DOCX of at most 20 MiB.`);
      continue;
    }
    try {
      const response = await fetch('/api/inbox', {
        method: 'POST',
        headers: {
          'X-Filename': encodeURIComponent(file.name),
          'Content-Type': 'application/octet-stream',
        },
        body: file,
      });
      if (!response.ok) throw new Error(`Upload failed (${response.status})`);
      notice(`${file.name} queued. Both exports and comparisons will run automatically.`);
    } catch (error) {
      notice(error.message);
    }
  }
  $('#upload').value = '';
  refresh().catch((error) => notice(error.message));
}
$('#upload').onchange = () => upload([...$('#upload').files]);
$('#refresh').onclick = () => refresh().catch((error) => notice(error.message));
$('#pair').onchange = () => {
  selectedPair = $('#pair').value;
  renderList();
  if (selectedId) selectDocument(selectedId);
};
for (const id of ['search', 'filter', 'sort', 'scope'])
  $('#' + id).addEventListener(id === 'search' ? 'input' : 'change', renderList);
let dragDepth = 0;
document.addEventListener('dragenter', (event) => {
  if (event.dataTransfer.types.includes('Files')) {
    event.preventDefault();
    dragDepth++;
    document.body.classList.add('dragging');
  }
});
document.addEventListener('dragover', (event) => event.preventDefault());
document.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) document.body.classList.remove('dragging');
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dragging');
  upload([...event.dataTransfer.files]);
});
if (['original', 'diagnostic', 'all'].includes(initial.get('scope')))
  $('#scope').value = initial.get('scope');
await refresh().catch((error) => notice(error.message));
setInterval(() => refresh().catch((error) => notice(error.message)), 5000);
