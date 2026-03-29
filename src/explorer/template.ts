export interface RenderExplorerPageOptions {
  title: string;
  theme: 'auto' | 'light' | 'dark';
  defaultPageSize: 25 | 50 | 100;
  prefix: string;
  authEnabled: boolean;
}

function getLightCssVars(): string {
  return `
  --color-bg: #ffffff;
  --color-surface: #f8f9fa;
  --color-border: #e1e4e8;
  --color-text: #24292e;
  --color-text-muted: #6a737d;
  --color-accent: #0366d6;
  --color-accent-hover: #0256b9;
  --color-row-hover: #f1f8ff;
  --color-sidebar-active: #e8f0fe;
  --color-json-string: #032f62;
  --color-json-number: #005cc5;
  --color-json-boolean: #d73a49;
  --color-json-null: #6a737d;
  --color-json-key: #d73a49;
  --sidebar-width: 220px;
  --detail-panel-width: 400px;
  --header-height: 48px;`;
}

function getDarkCssVars(): string {
  return `
  --color-bg: #0d1117;
  --color-surface: #161b22;
  --color-border: #30363d;
  --color-text: #c9d1d9;
  --color-text-muted: #8b949e;
  --color-accent: #58a6ff;
  --color-accent-hover: #79b8ff;
  --color-row-hover: #1f2937;
  --color-sidebar-active: #1f2937;
  --color-json-string: #a5d6ff;
  --color-json-number: #79c0ff;
  --color-json-boolean: #ff7b72;
  --color-json-null: #8b949e;
  --color-json-key: #ff7b72;`;
}

function buildThemeCss(theme: 'auto' | 'light' | 'dark'): string {
  if (theme === 'dark') {
    return `:root {${getLightCssVars()}
}
:root {${getDarkCssVars()}
}`;
  }
  if (theme === 'light') {
    return `:root {${getLightCssVars()}
}`;
  }
  // auto
  return `:root {${getLightCssVars()}
}
@media (prefers-color-scheme: dark) {
  :root {${getDarkCssVars()}
  }
}`;
}

export function renderExplorerPage(options: RenderExplorerPageOptions): string {
  const { title, theme, defaultPageSize, prefix, authEnabled } = options;

  const bodyClass = theme === 'dark' ? ' class="theme-dark"' : '';

  const apiKeyInput = authEnabled
    ? `<input id="api-key-input" type="password" placeholder="API key" style="padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);color:var(--color-text);font-size:12px;width:160px">`
    : '';

  const themeCss = buildThemeCss(theme);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtmlStatic(title)}</title>
<style>
${themeCss}
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  background: var(--color-bg);
  color: var(--color-text);
  display: grid;
  grid-template-rows: var(--header-height) 1fr;
  grid-template-columns: var(--sidebar-width) 1fr;
  height: 100vh;
  overflow: hidden;
}
header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-surface);
}
#sidebar {
  overflow-y: auto;
  border-right: 1px solid var(--color-border);
  background: var(--color-surface);
}
#main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg);
  transition: padding-right 0.2s ease;
}
#table-container {
  flex: 1;
  overflow: auto;
}
table { width: 100%; border-collapse: collapse; min-width: 600px; }
th, td { padding: 8px 12px; }
th {
  text-align: left;
  border-bottom: 2px solid var(--color-border);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: .05em;
}
th:hover { color: var(--color-accent); }
tbody tr {
  cursor: pointer;
  border-bottom: 1px solid var(--color-border);
}
tbody tr:hover { background: var(--color-row-hover); }
td { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#detail-panel {
  position: fixed;
  top: var(--header-height);
  right: 0;
  width: var(--detail-panel-width);
  height: calc(100vh - var(--header-height));
  transform: translateX(100%);
  transition: transform 0.2s ease;
  background: var(--color-surface);
  border-left: 1px solid var(--color-border);
  z-index: 10;
  display: flex;
  flex-direction: column;
}
#detail-panel.open { transform: translateX(0); }
.tab-btn {
  padding: 4px 10px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  cursor: pointer;
  background: var(--color-surface);
  color: var(--color-text-muted);
  font-size: 12px;
}
.tab-btn.active {
  background: var(--color-accent);
  color: #fff;
  border-color: var(--color-accent);
}
a { color: var(--color-accent); text-decoration: none; font-size: 12px; }
a:hover { color: var(--color-accent-hover); text-decoration: underline; }
.json-string { color: var(--color-json-string); }
.json-number { color: var(--color-json-number); }
.json-boolean { color: var(--color-json-boolean); }
.json-null { color: var(--color-json-null); }
.json-key { color: var(--color-json-key); }
</style>
</head>
<body${bodyClass}>
<header>
  <div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:16px">&#x1F5C4;</span>
    <strong id="header-title">${escapeHtmlStatic(title)}</strong>
  </div>
  <nav style="display:flex;gap:16px;align-items:center">
    ${apiKeyInput}
    <a href="/docs" target="_blank">Docs &#x2197;</a>
    <a href="https://github.com/matthew-gerstman/mongo-autorest" target="_blank">GitHub &#x2197;</a>
  </nav>
</header>
<aside id="sidebar">
  <div style="padding:12px 16px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted)">Collections</div>
  <div id="collections-list"></div>
</aside>
<main id="main">
  <div id="filter-bar" style="padding:8px 16px;border-bottom:1px solid var(--color-border);display:flex;flex-wrap:wrap;gap:8px;align-items:center"></div>
  <div id="table-container" style="overflow-x:auto"></div>
  <div id="pagination-bar" style="padding:8px 16px;border-top:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;gap:8px"></div>
  <div id="curl-bar" style="padding:8px 16px;border-top:1px solid var(--color-border);background:var(--color-surface);font-family:monospace;font-size:12px;display:flex;align-items:center;gap:8px;overflow-x:auto"></div>
</main>
<div id="detail-panel">
  <div id="detail-header" style="padding:12px 16px;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between">
    <div id="detail-tabs" style="display:flex;gap:4px">
      <button data-tab="document" class="tab-btn active">Document</button>
      <button data-tab="schema" class="tab-btn">Schema</button>
    </div>
    <button id="detail-close" style="background:none;border:none;cursor:pointer;font-size:18px;color:var(--color-text-muted)">&#x2715;</button>
  </div>
  <div id="detail-content" style="flex:1;overflow-y:auto;padding:16px"></div>
</div>
<script>
(() => {
  'use strict';

  const state = {
    collections: [],
    activeCollection: null,
    page: 1,
    pageSize: ${defaultPageSize},
    sort: null,
    filters: [],
    activeDocument: null,
    activeTab: 'document',
  };

  const prefix = '${escapeJsString(prefix)}';

  // ── Auth ───────────────────────────────────────────────────────────────────
  function getApiKey() {
    return document.getElementById('api-key-input')?.value ?? '';
  }

  function getHeaders() {
    const key = getApiKey();
    return key ? { 'x-api-key': key } : {};
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────
  async function fetchJson(url) {
    const res = await fetch(url, { headers: getHeaders() });
    if (!res.ok) throw new Error('HTTP ' + res.status + ': ' + await res.text());
    return res.json();
  }

  // ── URL builder ────────────────────────────────────────────────────────────
  function buildApiUrl() {
    const col = state.activeCollection;
    if (!col) return '';
    const params = new URLSearchParams();
    params.set('page', String(state.page));
    params.set('pageSize', String(state.pageSize));
    if (state.sort) params.set('sort', state.sort);
    if (state.filters.length > 0) {
      const filterObj = {};
      for (const f of state.filters) {
        if (f.operator === '=') filterObj[f.field] = f.value;
        else if (f.operator === '!=') filterObj[f.field] = { $ne: f.value };
        else if (f.operator === '>') filterObj[f.field] = { $gt: f.value };
        else if (f.operator === '<') filterObj[f.field] = { $lt: f.value };
        else if (f.operator === 'contains') filterObj[f.field] = { $regex: f.value, $options: 'i' };
      }
      params.set('filter', JSON.stringify(filterObj));
    }
    return prefix + '/' + col.slug + '?' + params.toString();
  }

  // ── Escape helper ──────────────────────────────────────────────────────────
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Curl bar ───────────────────────────────────────────────────────────────
  function renderCurlBar(apiUrl) {
    const curlBar = document.getElementById('curl-bar');
    if (!curlBar || !apiUrl) return;
    const origin = window.location.origin;
    const fullUrl = origin + apiUrl;
    const authHeader = ${authEnabled} ? " -H 'x-api-key: <your-key>'" : '';
    const cmd = "curl '" + fullUrl + "'" + authHeader;
    curlBar.innerHTML =
      '<span style="color:var(--color-text-muted);flex-shrink:0">curl</span>' +
      '<code style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(fullUrl) + escapeHtml(authHeader) + '</code>' +
      '<button onclick="navigator.clipboard.writeText(' + JSON.stringify(cmd) + ')" style="flex-shrink:0;padding:2px 8px;border:1px solid var(--color-border);border-radius:4px;cursor:pointer;background:var(--color-surface);color:var(--color-text);font-size:11px">Copy</button>' +
      '<a href="' + escapeHtml(fullUrl) + '" target="_blank" style="flex-shrink:0;color:var(--color-accent);text-decoration:none;font-size:11px">Open &#x2197;</a>';
  }

  // ── Table ──────────────────────────────────────────────────────────────────
  function getOrderedFields(schema) {
    const props = schema?.properties ?? {};
    const fields = Object.keys(props);
    return ['_id', ...fields.filter(f => f !== '_id')];
  }

  function formatCell(value) {
    if (value === null || value === undefined) return '<span style="color:var(--color-text-muted)">null</span>';
    if (Array.isArray(value)) return '<span style="color:var(--color-text-muted)">[' + value.length + ' items]</span>';
    if (typeof value === 'object') return '<span style="color:var(--color-text-muted)">{...}</span>';
    const str = String(value);
    const escaped = escapeHtml(str.length > 40 ? str.slice(0, 40) + '\\u2026' : str);
    return escaped;
  }

  function renderTable(rows, pagination) {
    const container = document.getElementById('table-container');
    if (!container) return;

    if (!rows || rows.length === 0) {
      container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted)">No records found</div>';
      renderPagination(pagination);
      return;
    }

    const schema = state.activeCollection?.schema;
    const fields = getOrderedFields(schema);
    const dataFields = new Set(rows.flatMap(r => Object.keys(r)));
    for (const f of dataFields) { if (!fields.includes(f)) fields.push(f); }

    let html = '<table><thead><tr>';
    for (const f of fields) {
      const isActive = state.sort === f || state.sort === '-' + f;
      const arrow = state.sort === f ? ' \\u25b2' : state.sort === '-' + f ? ' \\u25bc' : '';
      html += '<th data-sort="' + escapeHtml(f) + '"' + (isActive ? ' style="color:var(--color-accent)"' : '') + '>' + escapeHtml(f) + arrow + '</th>';
    }
    html += '</tr></thead><tbody>';

    for (const row of rows) {
      const id = row._id?.$oid ?? row._id ?? '';
      html += '<tr data-doc-id="' + escapeHtml(String(id)) + '">';
      for (const f of fields) {
        html += '<td>' + formatCell(row[f]) + '</td>';
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
    renderPagination(pagination);
  }

  // ── Pagination ─────────────────────────────────────────────────────────────
  function renderPagination(pagination) {
    const bar = document.getElementById('pagination-bar');
    if (!bar || !pagination) return;
    const { page, totalPages, total } = pagination;
    bar.innerHTML =
      '<div style="color:var(--color-text-muted)">' + total + ' records</div>' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<button id="prev-btn" ' + (page <= 1 ? 'disabled' : '') + ' style="padding:4px 10px;border:1px solid var(--color-border);border-radius:4px;cursor:pointer;background:var(--color-surface);color:var(--color-text)">\u2190 Prev</button>' +
        '<span>Page ' + page + ' of ' + (totalPages || 1) + '</span>' +
        '<button id="next-btn" ' + (page >= (totalPages || 1) ? 'disabled' : '') + ' style="padding:4px 10px;border:1px solid var(--color-border);border-radius:4px;cursor:pointer;background:var(--color-surface);color:var(--color-text)">Next \u2192</button>' +
        '<select id="page-size-select" style="padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);color:var(--color-text)">' +
          [25, 50, 100].map(n => '<option value="' + n + '"' + (state.pageSize === n ? ' selected' : '') + '>' + n + ' / page</option>').join('') +
        '</select>' +
      '</div>';
  }

  // ── Load table ─────────────────────────────────────────────────────────────
  async function loadTable() {
    if (!state.activeCollection) return;
    const url = buildApiUrl();
    const container = document.getElementById('table-container');
    if (container) container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted)">Loading\u2026</div>';
    try {
      const data = await fetchJson(url);
      renderTable(data.data, data.pagination);
      renderCurlBar(url);
    } catch (err) {
      if (container) container.innerHTML = '<div style="padding:40px;text-align:center;color:#d73a49">Error: ' + escapeHtml(String(err)) + '</div>';
    }
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────
  function renderSidebar() {
    const list = document.getElementById('collections-list');
    if (!list) return;
    if (state.collections.length === 0) {
      list.innerHTML = '<div style="padding:12px 16px;color:var(--color-text-muted)">No collections</div>';
      return;
    }
    list.innerHTML = state.collections.map(col => {
      const isActive = state.activeCollection?.slug === col.slug;
      return '<div data-collection-slug="' + escapeHtml(col.slug) + '" style="padding:8px 16px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-radius:4px;margin:2px 8px;background:' + (isActive ? 'var(--color-sidebar-active)' : 'transparent') + ';color:' + (isActive ? 'var(--color-accent)' : 'var(--color-text)') + '">' +
        '<span style="font-weight:' + (isActive ? '600' : '400') + '">' + escapeHtml(col.name) + '</span>' +
        '<span style="font-size:11px;padding:1px 6px;background:var(--color-surface);border:1px solid var(--color-border);border-radius:10px;color:var(--color-text-muted)">' + col.count + '</span>' +
        '</div>';
    }).join('');
  }

  async function selectCollection(col) {
    state.activeCollection = col;
    state.page = 1;
    state.sort = null;
    state.filters = [];
    closeDetailPanel();
    renderSidebar();
    renderFilterBar();
    await loadTable();
  }

  // ── Filter bar ─────────────────────────────────────────────────────────────
  function renderFilterBar() {
    const bar = document.getElementById('filter-bar');
    if (!bar) return;
    const schema = state.activeCollection?.schema;
    const fields = schema ? getOrderedFields(schema) : [];
    const operators = ['=', '!=', '>', '<', 'contains'];

    let html = '';
    for (let i = 0; i < state.filters.length; i++) {
      const f = state.filters[i];
      html += '<div style="display:flex;align-items:center;gap:4px;padding:2px 8px;background:var(--color-sidebar-active);border:1px solid var(--color-accent);border-radius:4px;font-size:12px">' +
        '<span>' + escapeHtml(f.field) + ' ' + escapeHtml(f.operator) + ' ' + escapeHtml(f.value) + '</span>' +
        '<button data-remove-filter="' + i + '" style="background:none;border:none;cursor:pointer;color:var(--color-text-muted);padding:0 2px;font-size:14px">\u00d7</button>' +
        '</div>';
    }
    if (fields.length > 0) {
      html += '<select id="filter-field" style="padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);color:var(--color-text);font-size:12px">' +
        fields.map(f => '<option value="' + escapeHtml(f) + '">' + escapeHtml(f) + '</option>').join('') +
        '</select>' +
        '<select id="filter-op" style="padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);color:var(--color-text);font-size:12px">' +
        operators.map(op => '<option value="' + op + '">' + op + '</option>').join('') +
        '</select>' +
        '<input id="filter-value" type="text" placeholder="value" style="padding:4px 8px;border:1px solid var(--color-border);border-radius:4px;background:var(--color-surface);color:var(--color-text);font-size:12px;width:120px">' +
        '<button id="add-filter-btn" style="padding:4px 10px;border:1px solid var(--color-border);border-radius:4px;cursor:pointer;background:var(--color-surface);color:var(--color-text);font-size:12px">+ Filter</button>' +
        (state.filters.length > 0 ? '<button id="clear-filters-btn" style="padding:4px 10px;border:1px solid var(--color-border);border-radius:4px;cursor:pointer;background:var(--color-surface);color:var(--color-text-muted);font-size:12px">Clear all</button>' : '<button id="clear-filters-btn" style="display:none"></button>');
    }
    bar.innerHTML = html;
  }

  // ── Document detail ────────────────────────────────────────────────────────
  async function openDocument(id) {
    if (!state.activeCollection) return;
    const url = prefix + '/' + state.activeCollection.slug + '/' + id;
    try {
      const doc = await fetchJson(url);
      state.activeDocument = doc;
      renderDetailPanel();
      document.getElementById('detail-panel')?.classList.add('open');
      const main = document.getElementById('main');
      if (main) main.style.paddingRight = 'var(--detail-panel-width)';
      renderCurlBar(prefix + '/' + state.activeCollection.slug + '/' + id);
    } catch (err) {
      const content = document.getElementById('detail-content');
      if (content) content.innerHTML = '<div style="color:#d73a49">Error: ' + escapeHtml(String(err)) + '</div>';
    }
  }

  function closeDetailPanel() {
    document.getElementById('detail-panel')?.classList.remove('open');
    const main = document.getElementById('main');
    if (main) main.style.paddingRight = '0';
    state.activeDocument = null;
  }

  function renderDetailPanel() {
    if (state.activeTab === 'document') renderDocumentTab();
    else renderSchemaTab();
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
    });
  }

  // ── JSON syntax highlight ──────────────────────────────────────────────────
  function syntaxHighlight(json) {
    const str = typeof json === 'string' ? json : JSON.stringify(json, null, 2);
    return escapeHtml(str).replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
      function(match) {
        let cls = 'json-number';
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? 'json-key' : 'json-string';
        } else if (/true|false/.test(match)) {
          cls = 'json-boolean';
        } else if (/null/.test(match)) {
          cls = 'json-null';
        }
        return '<span class="' + cls + '">' + match + '</span>';
      }
    );
  }

  function renderDocumentTab() {
    const content = document.getElementById('detail-content');
    if (!content) return;
    if (!state.activeDocument) { content.innerHTML = ''; return; }
    content.innerHTML = '<pre style="font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-all">' + syntaxHighlight(state.activeDocument) + '</pre>';
  }

  function renderSchemaTab() {
    const content = document.getElementById('detail-content');
    if (!content) return;
    const schema = state.activeCollection?.schema;
    if (!schema?.properties) { content.innerHTML = '<div style="color:var(--color-text-muted)">No schema available</div>'; return; }
    const props = schema.properties;
    const required = new Set(schema.required ?? []);
    const fields = getOrderedFields(schema);
    let html = '<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr>' +
      '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--color-border);color:var(--color-text-muted);font-size:11px;font-weight:600;text-transform:uppercase">Field</th>' +
      '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--color-border);color:var(--color-text-muted);font-size:11px;font-weight:600;text-transform:uppercase">Type</th>' +
      '<th style="padding:6px 8px;text-align:left;border-bottom:1px solid var(--color-border);color:var(--color-text-muted);font-size:11px;font-weight:600;text-transform:uppercase">Req</th>' +
      '</tr></thead><tbody>';
    for (const f of fields) {
      const prop = props[f] ?? {};
      const type = prop.type ?? (prop.oneOf ? prop.oneOf.map((t) => t.type).join('|') : '?');
      html += '<tr style="border-bottom:1px solid var(--color-border)">' +
        '<td style="padding:6px 8px;font-family:monospace;color:var(--color-json-key)">' + escapeHtml(f) + '</td>' +
        '<td style="padding:6px 8px;color:var(--color-json-number)">' + escapeHtml(String(type)) + '</td>' +
        '<td style="padding:6px 8px">' + (required.has(f) ? '\u2713' : '') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    content.innerHTML = html;
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const manifest = await fetchJson('/explorer-api/collections');
      state.collections = manifest.collections;
      renderSidebar();
      if (state.collections.length > 0) {
        await selectCollection(state.collections[0]);
      } else {
        const container = document.getElementById('table-container');
        if (container) container.innerHTML = '<div style="padding:40px;text-align:center;color:var(--color-text-muted)">No collections found</div>';
      }
    } catch (err) {
      const container = document.getElementById('table-container');
      if (container) container.innerHTML = '<div style="padding:40px;text-align:center;color:#d73a49">Failed to load collections: ' + String(err) + '</div>';
    }
  }

  // ── Event delegation ───────────────────────────────────────────────────────
  document.addEventListener('click', async (e) => {
    const target = e.target;

    const colItem = target.closest('[data-collection-slug]');
    if (colItem) {
      const slug = colItem.dataset.collectionSlug;
      const col = state.collections.find(c => c.slug === slug);
      if (col) await selectCollection(col);
      return;
    }

    const row = target.closest('[data-doc-id]');
    if (row && !target.closest('th')) {
      await openDocument(row.dataset.docId);
      return;
    }

    const th = target.closest('th[data-sort]');
    if (th) {
      const field = th.dataset.sort;
      if (state.sort === field) state.sort = '-' + field;
      else if (state.sort === '-' + field) state.sort = null;
      else state.sort = field;
      state.page = 1;
      await loadTable();
      return;
    }

    if (target.closest('#detail-close')) {
      closeDetailPanel();
      const url = buildApiUrl();
      if (url) renderCurlBar(url);
      return;
    }

    const tab = target.closest('[data-tab]');
    if (tab && tab.closest('#detail-tabs')) {
      state.activeTab = tab.dataset.tab;
      renderDetailPanel();
      return;
    }

    if (target.id === 'prev-btn') {
      if (state.page > 1) { state.page--; await loadTable(); }
      return;
    }
    if (target.id === 'next-btn') {
      state.page++;
      await loadTable();
      return;
    }

    if (target.id === 'add-filter-btn') {
      const field = document.getElementById('filter-field')?.value;
      const op = document.getElementById('filter-op')?.value;
      const value = document.getElementById('filter-value')?.value;
      if (field && op && value !== undefined && value !== '') {
        state.filters.push({ field, operator: op, value });
        state.page = 1;
        renderFilterBar();
        await loadTable();
      }
      return;
    }

    if (target.id === 'clear-filters-btn') {
      state.filters = [];
      state.page = 1;
      renderFilterBar();
      await loadTable();
      return;
    }

    const removeBtn = target.closest('[data-remove-filter]');
    if (removeBtn) {
      const idx = parseInt(removeBtn.dataset.removeFilter, 10);
      state.filters.splice(idx, 1);
      state.page = 1;
      renderFilterBar();
      await loadTable();
      return;
    }
  });

  document.addEventListener('change', async (e) => {
    if (e.target.id === 'page-size-select') {
      state.pageSize = parseInt(e.target.value, 10);
      state.page = 1;
      await loadTable();
    }
  });

  document.addEventListener('input', async (e) => {
    if (e.target.id === 'api-key-input') {
      state.page = 1;
      await init();
    }
  });

  document.addEventListener('DOMContentLoaded', () => { void init(); });
})();
</script>
</body>
</html>`;
}

function escapeHtmlStatic(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeJsString(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"');
}
