import { init as initDB, DB } from '../db/indexeddb.js';

// ─────────────────────────────────────────────
// Quick Save popup
// Features: smart board suggestion, inline board/page creation, editable title,
// cross-board duplicate detection (open / move), note + tags, save & close tab,
// stash scopes, keyboard flow, and Undo after saving.
// ─────────────────────────────────────────────

const NEW_OPT = '__new__';
const UNDO_MS = 3500;

const $ = (id) => document.getElementById(id);

const els = {
  favicon: $('favicon'),
  title: $('tab-title'),
  url: $('tab-url'),
  boardSelect: $('board-select'),
  pageSelect: $('page-select'),
  suggestChip: $('suggest-chip'),
  newBoardRow: $('new-board-row'),
  newBoardInput: $('new-board-input'),
  newPageRow: $('new-page-row'),
  newPageInput: $('new-page-input'),
  detailsToggle: $('details-toggle'),
  detailsPane: $('details-pane'),
  noteInput: $('note-input'),
  tagsInput: $('tags-input'),
  tagPreview: $('tag-preview'),
  dupeWarn: $('dupe-warning'),
  dupeLocations: $('dupe-locations'),
  dupeOpen: $('dupe-open'),
  dupeMove: $('dupe-move'),
  closeTabCheck: $('close-tab-check'),
  btnSave: $('btn-save'),
  btnCancel: $('btn-cancel'),
  stashScope: $('stash-scope'),
  stashCloseCheck: $('stash-close-check'),
  btnStash: $('btn-stash-all-popup'),
  mainView: $('main-view'),
  savedMsg: $('saved-msg'),
  savedTitle: $('saved-title'),
  savedSub: $('saved-sub'),
  undoBtn: $('undo-btn'),
  doneBtn: $('done-btn'),
  countdownFill: $('countdown-fill')
};

const state = {
  tab: { id: null, windowId: null, index: 0, title: 'Untitled', url: '', favicon: '' },
  boards: [],
  dupes: [],            // [{ bk, board, page }]
  lastBoardValue: null,
  lastPageValue: null,
  busy: false,
  undoFn: null,         // reverts the last action
  afterFn: null,        // runs when the popup finishes (e.g. close tabs)
  finishTimer: null
};

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function parseTags(raw) {
  return [...new Set(
    (raw || '')
      .split(/[\s,]+/)
      .map(t => t.replace(/^#+/, '').trim().toLowerCase())
      .filter(Boolean)
  )].slice(0, 12);
}

function tabsQuery(q) {
  return new Promise(r => chrome.tabs.query(q, t => r(t || [])));
}

function tabsGet(id) {
  return new Promise(r => chrome.tabs.get(id, t => { void chrome.runtime.lastError; r(t || null); }));
}

function isSavableUrl(url) {
  if (!url) return false;
  const ext = chrome.runtime.getURL('');
  return !url.startsWith('chrome://newtab') && !url.startsWith(ext) && !url.startsWith('chrome://extensions');
}

function makeOption(value, text, cls) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = text;
  if (cls) o.className = cls;
  return o;
}

async function applyAccent() {
  try {
    const accent = await DB.settings.get('theme_accent');
    if (accent) {
      document.documentElement.style.setProperty('--accent', accent);
      document.documentElement.style.setProperty('--accent-glow', accent + '33');
    }
  } catch { /* keep default */ }
}

// ─────────────────────────────────────────────
// Resolve the tab being saved
// (popup action → active tab; window opened by service worker → URL params)
// ─────────────────────────────────────────────
async function resolveTab() {
  const params = new URLSearchParams(location.search);
  if (params.get('url')) {
    state.tab.title = params.get('title') || 'Untitled';
    state.tab.url = params.get('url');
    state.tab.favicon = params.get('fav') || '';
    const tabId = parseInt(params.get('tabId'), 10);
    if (!Number.isNaN(tabId)) {
      const t = await tabsGet(tabId);
      if (t) { state.tab.id = t.id; state.tab.windowId = t.windowId; state.tab.index = t.index; }
    }
    return;
  }
  const [t] = await tabsQuery({ active: true, currentWindow: true });
  if (t) {
    state.tab = {
      id: t.id, windowId: t.windowId, index: t.index,
      title: t.title || 'Untitled', url: t.url || '', favicon: t.favIconUrl || ''
    };
  }
}

function renderHeader() {
  els.title.value = state.tab.title;
  els.url.textContent = state.tab.url;
  els.url.title = state.tab.url;

  const host = hostOf(state.tab.url);
  const fallback = host ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32` : '';
  els.favicon.dataset.fallback = fallback;
  els.favicon.onerror = function () {
    if (!this.dataset.tried && this.dataset.fallback) { this.dataset.tried = '1'; this.src = this.dataset.fallback; }
    else this.style.visibility = 'hidden';
  };
  els.favicon.src = state.tab.favicon || fallback || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  if (!isSavableUrl(state.tab.url)) {
    els.btnSave.disabled = true;
    els.btnSave.title = 'This page cannot be saved';
  }
}

// ─────────────────────────────────────────────
// Boards & pages
// ─────────────────────────────────────────────
function renderBoards(selectId) {
  els.boardSelect.innerHTML = '';
  state.boards.forEach(b => els.boardSelect.appendChild(makeOption(b.id, b.title)));
  els.boardSelect.appendChild(makeOption(NEW_OPT, '＋ New board…', 'opt-new'));
  if (selectId && state.boards.some(b => b.id === selectId)) els.boardSelect.value = selectId;
  else if (state.boards.length) els.boardSelect.value = state.boards[0].id;
  else els.boardSelect.value = NEW_OPT;
  state.lastBoardValue = els.boardSelect.value;
}

async function loadPages(boardId, selectPageId) {
  els.pageSelect.innerHTML = '';
  let pages = [];
  if (boardId && boardId !== NEW_OPT) pages = await DB.pages.getForBoard(boardId);
  pages.forEach(p => els.pageSelect.appendChild(makeOption(p.id, p.title)));
  els.pageSelect.appendChild(makeOption(NEW_OPT, '＋ New page…', 'opt-new'));
  if (selectPageId && pages.some(p => p.id === selectPageId)) els.pageSelect.value = selectPageId;
  else if (pages.length) els.pageSelect.value = pages[0].id;
  else els.pageSelect.value = NEW_OPT;
  state.lastPageValue = els.pageSelect.value;
  updateDupeUi();
}

function showInline(row, input, show) {
  row.classList.toggle('hidden', !show);
  if (show) { input.value = ''; setTimeout(() => input.focus(), 0); }
}

async function createBoardInline() {
  const name = els.newBoardInput.value.trim();
  if (!name) { els.newBoardInput.focus(); return; }
  const board = await DB.boards.create(name);
  const page = await DB.pages.create(board.id, 'General');
  state.boards.push(board);
  renderBoards(board.id);
  await loadPages(board.id, page.id);
  showInline(els.newBoardRow, els.newBoardInput, false);
  els.suggestChip.classList.add('hidden');
  els.btnSave.focus();
}

async function createPageInline() {
  const name = els.newPageInput.value.trim();
  const boardId = els.boardSelect.value;
  if (!name) { els.newPageInput.focus(); return; }
  if (!boardId || boardId === NEW_OPT) return;
  const page = await DB.pages.create(boardId, name);
  await loadPages(boardId, page.id);
  showInline(els.newPageRow, els.newPageInput, false);
  els.btnSave.focus();
}

function cancelInlineBoard() {
  showInline(els.newBoardRow, els.newBoardInput, false);
  if (state.boards.length) {
    const fallback = state.boards.some(b => b.id === state.lastBoardValue) ? state.lastBoardValue : state.boards[0].id;
    els.boardSelect.value = fallback;
    loadPages(fallback);
  }
}

function cancelInlinePage() {
  showInline(els.newPageRow, els.newPageInput, false);
  const opts = [...els.pageSelect.options].filter(o => o.value !== NEW_OPT);
  if (opts.length) els.pageSelect.value = opts.some(o => o.value === state.lastPageValue) ? state.lastPageValue : opts[0].value;
  updateDupeUi();
}

// ─────────────────────────────────────────────
// Smart suggestion (domain memory → last used → first board)
// ─────────────────────────────────────────────
async function pickSuggestion() {
  const host = hostOf(state.tab.url);
  const domainMap = (await DB.settings.get('qs_domain_map')) || {};
  const last = await DB.settings.get('qs_last_target');
  const valid = (t) => t && state.boards.some(b => b.id === t.boardId);

  if (host && valid(domainMap[host])) {
    return { ...domainMap[host], label: `✨ Suggested for ${host}` };
  }
  // Fall back to a board that already holds this domain
  if (host) {
    const all = await DB.bookmarks.getAllActive();
    const match = all.filter(b => hostOf(b.url) === host).sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];
    if (match) {
      const page = await DB.pages.get(match.page_id);
      if (page && state.boards.some(b => b.id === page.board_id)) {
        return { boardId: page.board_id, pageId: page.id, label: `✨ Other ${host} links live here` };
      }
    }
  }
  if (valid(last)) return { ...last, label: '🕘 Last used' };
  return null;
}

async function rememberTarget(boardId, pageId) {
  const host = hostOf(state.tab.url);
  const target = { boardId, pageId };
  await DB.settings.set('qs_last_target', target);
  if (host) {
    const map = (await DB.settings.get('qs_domain_map')) || {};
    map[host] = { ...target, at: Date.now() };
    // Keep the map bounded
    const entries = Object.entries(map).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 300);
    await DB.settings.set('qs_domain_map', Object.fromEntries(entries));
  }
}

// ─────────────────────────────────────────────
// Duplicate detection (across all boards)
// ─────────────────────────────────────────────
async function findDupes() {
  if (!state.tab.url) return [];
  const bks = await DB.bookmarks.findByUrl(state.tab.url);
  const out = [];
  for (const bk of bks) {
    const page = await DB.pages.get(bk.page_id);
    if (!page) continue;
    const board = state.boards.find(b => b.id === page.board_id);
    if (!board) continue;
    out.push({ bk, board, page });
  }
  return out;
}

function updateDupeUi() {
  if (!state.dupes.length) { els.dupeWarn.classList.add('hidden'); return; }
  const pageId = els.pageSelect.value;
  const inThisPage = state.dupes.some(d => d.page.id === pageId);
  const escape = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const where = state.dupes
    .slice(0, 3)
    .map(d => `<strong>${escape(d.board.title)}</strong> › ${escape(d.page.title)}`)
    .join(', ');
  const more = state.dupes.length > 3 ? ` +${state.dupes.length - 3} more` : '';
  els.dupeLocations.innerHTML = `⚠ Already saved in ${where}${more}${inThisPage ? ' — including this page.' : '.'}`;
  els.dupeMove.classList.toggle('hidden', inThisPage || !pageId || pageId === NEW_OPT);
  els.dupeWarn.classList.remove('hidden');
}

// ─────────────────────────────────────────────
// Finish / undo flow
// ─────────────────────────────────────────────
function showSuccess(title, sub, undoFn, afterFn) {
  state.undoFn = undoFn;
  state.afterFn = afterFn || null;
  els.savedTitle.textContent = title;
  els.savedSub.textContent = sub || '';
  els.mainView.style.display = 'none';
  els.savedMsg.classList.remove('hidden');
  els.undoBtn.classList.toggle('hidden', !undoFn);

  els.countdownFill.style.transition = 'none';
  els.countdownFill.style.width = '100%';
  requestAnimationFrame(() => requestAnimationFrame(() => {
    els.countdownFill.style.transition = `width ${UNDO_MS}ms linear`;
    els.countdownFill.style.width = '0%';
  }));

  clearTimeout(state.finishTimer);
  state.finishTimer = setTimeout(finish, UNDO_MS);
  els.doneBtn.focus();
}

async function finish() {
  clearTimeout(state.finishTimer);
  const after = state.afterFn;
  state.afterFn = null;
  if (after) { try { await after(); } catch { /* tab may already be gone */ } }
  window.close();
}

async function undo() {
  clearTimeout(state.finishTimer);
  const fn = state.undoFn;
  state.undoFn = null;
  state.afterFn = null; // never close tabs after an undo
  if (fn) { try { await fn(); } catch (e) { console.warn('Undo failed', e); } }
  els.savedTitle.textContent = 'Undone';
  els.savedSub.textContent = 'Nothing was changed.';
  els.undoBtn.classList.add('hidden');
  els.countdownFill.style.transition = 'none';
  els.countdownFill.style.width = '0%';
  setTimeout(() => window.close(), 900);
}

// ─────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────
async function save() {
  if (state.busy || els.btnSave.disabled) return;
  const boardId = els.boardSelect.value;
  const pageId = els.pageSelect.value;
  if (boardId === NEW_OPT) { showInline(els.newBoardRow, els.newBoardInput, true); return; }
  if (!pageId || pageId === NEW_OPT) { showInline(els.newPageRow, els.newPageInput, true); return; }
  if (!state.tab.url) return;

  state.busy = true;
  const title = els.title.value.trim() || state.tab.url;
  const bk = await DB.bookmarks.create(pageId, {
    url: state.tab.url,
    title,
    favicon: state.tab.favicon,
    description: els.noteInput.value.trim(),
    tags: parseTags(els.tagsInput.value)
  });
  await rememberTarget(boardId, pageId);
  await DB.settings.set('qs_close_after_save', els.closeTabCheck.checked);

  const board = state.boards.find(b => b.id === boardId);
  const pageName = els.pageSelect.selectedOptions[0]?.textContent || '';
  const closeTab = els.closeTabCheck.checked && state.tab.id != null;

  showSuccess(
    'Saved!',
    `${board ? board.title : 'Board'} › ${pageName}${closeTab ? ' · tab will close' : ''}`,
    () => DB.bookmarks.hardDelete(bk.id),
    closeTab ? () => chrome.tabs.remove(state.tab.id) : null
  );
}

async function moveDupeHere() {
  const pageId = els.pageSelect.value;
  const boardId = els.boardSelect.value;
  if (!pageId || pageId === NEW_OPT || !state.dupes.length) return;
  const { bk } = state.dupes[0];
  const prev = { page_id: bk.page_id, order: bk.order, title: bk.title };
  const existing = await DB.bookmarks.getForPage(pageId);
  bk.page_id = pageId;
  bk.order = existing.length ? Math.max(...existing.map(b => b.order)) + 1 : 0;
  const newTitle = els.title.value.trim();
  if (newTitle) bk.title = newTitle;
  bk.updated_at = Date.now();
  await DB.bookmarks.save(bk);
  await rememberTarget(boardId, pageId);

  const board = state.boards.find(b => b.id === boardId);
  showSuccess('Moved!', `Now in ${board ? board.title : 'board'} › ${els.pageSelect.selectedOptions[0]?.textContent || ''}`, async () => {
    Object.assign(bk, prev, { updated_at: Date.now() });
    await DB.bookmarks.save(bk);
  });
}

async function collectStashTabs(scope) {
  const winId = state.tab.windowId;
  let tabs;
  if (scope === 'all') {
    tabs = await tabsQuery({});
  } else {
    tabs = winId != null ? await tabsQuery({ windowId: winId }) : await tabsQuery({ currentWindow: true });
    if (scope === 'right') tabs = tabs.filter(t => t.index > state.tab.index);
    if (scope === 'selected') tabs = tabs.filter(t => t.highlighted);
  }
  return tabs.filter(t => isSavableUrl(t.url) && !t.pinned);
}

async function stash() {
  if (state.busy) return;
  const scope = els.stashScope.value;
  const tabs = await collectStashTabs(scope);
  if (!tabs.length) {
    els.btnStash.textContent = 'No tabs';
    setTimeout(() => { els.btnStash.textContent = '⚡ Stash'; }, 1200);
    return;
  }
  state.busy = true;
  await DB.settings.set('qs_stash_scope', scope);
  await DB.settings.set('qs_stash_close', els.stashCloseCheck.checked);

  const nowStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const board = await DB.boards.create(`Session — ${nowStr}`);
  const page = await DB.pages.create(board.id, 'Main');
  const created = [];
  for (const t of tabs) {
    created.push(await DB.bookmarks.create(page.id, { url: t.url, title: t.title || t.url, favicon: t.favIconUrl || '' }));
  }

  const closeIds = els.stashCloseCheck.checked ? tabs.map(t => t.id) : [];
  showSuccess(
    `Stashed ${tabs.length} tab${tabs.length === 1 ? '' : 's'}!`,
    `New board “${board.title}”${closeIds.length ? ' · tabs will close' : ''}`,
    async () => {
      for (const bk of created) await DB.bookmarks.hardDelete(bk.id);
      await DB.pages.delete(page.id);
      await DB.boards.hardDelete(board.id);
    },
    closeIds.length ? () => chrome.tabs.remove(closeIds) : null
  );
}

function openBoardTab() {
  chrome.tabs.create({ url: chrome.runtime.getURL('newtab/index.html') });
  window.close();
}

// ─────────────────────────────────────────────
// Keyboard flow
// ─────────────────────────────────────────────
function cycleBoard(dir) {
  const opts = [...els.boardSelect.options].filter(o => o.value !== NEW_OPT);
  if (!opts.length) return;
  const idx = opts.findIndex(o => o.value === els.boardSelect.value);
  const next = opts[(idx + dir + opts.length) % opts.length];
  els.boardSelect.value = next.value;
  els.boardSelect.dispatchEvent(new Event('change'));
}

function onKeyDown(e) {
  const successVisible = !els.savedMsg.classList.contains('hidden');
  if (successVisible) {
    if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); finish(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
    return;
  }

  const target = e.target;
  if (e.key === 'Escape') {
    e.preventDefault();
    if (!els.newBoardRow.classList.contains('hidden')) return cancelInlineBoard();
    if (!els.newPageRow.classList.contains('hidden')) return cancelInlinePage();
    return window.close();
  }

  if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    cycleBoard(e.key === 'ArrowUp' ? -1 : 1);
    return;
  }

  if (e.key === 'Enter') {
    if (target === els.newBoardInput) { e.preventDefault(); return createBoardInline(); }
    if (target === els.newPageInput) { e.preventDefault(); return createPageInline(); }
    if (target === els.noteInput && !(e.ctrlKey || e.metaKey)) return; // allow newlines
    if (target.tagName === 'BUTTON') return; // let the focused button handle it
    e.preventDefault();
    save();
  }
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────
(async function boot() {
  try {
    await resolveTab();
    renderHeader();
    await initDB();
    await applyAccent();

    state.boards = await DB.boards.getAll();
    const suggestion = await pickSuggestion();
    renderBoards(suggestion?.boardId);
    await loadPages(els.boardSelect.value, suggestion?.pageId);
    if (suggestion && els.boardSelect.value === suggestion.boardId) {
      els.suggestChip.textContent = suggestion.label;
      els.suggestChip.title = suggestion.label;
      els.suggestChip.classList.remove('hidden');
    }
    if (els.boardSelect.value === NEW_OPT) showInline(els.newBoardRow, els.newBoardInput, true);

    state.dupes = await findDupes();
    updateDupeUi();

    els.closeTabCheck.checked = !!(await DB.settings.get('qs_close_after_save'));
    els.closeTabCheck.disabled = state.tab.id == null;
    const savedScope = await DB.settings.get('qs_stash_scope');
    if (savedScope) els.stashScope.value = savedScope;
    els.stashCloseCheck.checked = !!(await DB.settings.get('qs_stash_close'));

    // Events
    els.boardSelect.addEventListener('change', async () => {
      els.suggestChip.classList.add('hidden');
      if (els.boardSelect.value === NEW_OPT) {
        showInline(els.newBoardRow, els.newBoardInput, true);
        await loadPages(null);
        return;
      }
      showInline(els.newBoardRow, els.newBoardInput, false);
      showInline(els.newPageRow, els.newPageInput, false);
      state.lastBoardValue = els.boardSelect.value;
      await loadPages(els.boardSelect.value);
    });

    els.pageSelect.addEventListener('change', () => {
      if (els.pageSelect.value === NEW_OPT) {
        if (els.boardSelect.value === NEW_OPT) { cancelInlinePage(); return; }
        showInline(els.newPageRow, els.newPageInput, true);
      } else {
        showInline(els.newPageRow, els.newPageInput, false);
        state.lastPageValue = els.pageSelect.value;
      }
      updateDupeUi();
    });

    $('new-board-ok').addEventListener('click', createBoardInline);
    $('new-board-cancel').addEventListener('click', cancelInlineBoard);
    $('new-page-ok').addEventListener('click', createPageInline);
    $('new-page-cancel').addEventListener('click', cancelInlinePage);

    els.detailsToggle.addEventListener('click', () => {
      const open = els.detailsPane.classList.toggle('hidden') === false;
      els.detailsToggle.classList.toggle('open', open);
      if (open) els.noteInput.focus();
    });

    els.tagsInput.addEventListener('input', () => {
      els.tagPreview.innerHTML = '';
      parseTags(els.tagsInput.value).forEach(t => {
        const s = document.createElement('span');
        s.className = 'tag-pill';
        s.textContent = '#' + t;
        els.tagPreview.appendChild(s);
      });
    });

    els.title.addEventListener('focus', () => els.title.select());
    els.dupeOpen.addEventListener('click', openBoardTab);
    els.dupeMove.addEventListener('click', moveDupeHere);
    els.btnSave.addEventListener('click', save);
    els.btnCancel.addEventListener('click', () => window.close());
    els.btnStash.addEventListener('click', stash);
    els.undoBtn.addEventListener('click', undo);
    els.doneBtn.addEventListener('click', finish);
    document.addEventListener('keydown', onKeyDown);

    if (!els.btnSave.disabled && els.boardSelect.value !== NEW_OPT) els.btnSave.focus();
  } catch (err) {
    els.title.value = 'Error: ' + err.message;
  }
})();
