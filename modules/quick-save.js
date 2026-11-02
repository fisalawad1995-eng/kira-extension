// Board Tab — Quick Save Module
// Handles the in-page Quick Save picker UI (triggered by service worker message).

import { DB } from '../db/indexeddb.js';

let _pendingTab = null; // { title, url, favIconUrl }

// ─────────────────────────────────────────────
// Message listener (called from service worker)
// ─────────────────────────────────────────────
export function initQuickSaveListener() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'QUICK_SAVE') {
      _pendingTab = msg.tab;
      openQuickSavePicker(_pendingTab);
      sendResponse({ ok: true });
    }
    return true;
  });
}

// ─────────────────────────────────────────────
// Picker modal (rendered inside the new tab page)
// ─────────────────────────────────────────────
export function openQuickSavePicker(tab) {
  _removePicker();

  const overlay = document.createElement('div');
  overlay.id = 'qs-overlay';
  overlay.className = 'modal';

  let hostname = '';
  try { hostname = new URL(tab.url).hostname; } catch {}
  const fallbackSrc = hostname ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32` : '';

  overlay.innerHTML = `
    <div class="qs-picker-content" id="qs-picker">
      <div class="qs-header">
        <div class="qs-tab-info">
          <div class="qs-tab-title">${_esc(tab.title)}</div>
          <div class="qs-tab-url">${_esc(tab.url)}</div>
        </div>
      </div>

      <label class="qs-label">Save to Board</label>
      <select id="qs-board-select" class="qs-select"></select>

      <label class="qs-label">Page</label>
      <select id="qs-page-select" class="qs-select"></select>

      <div id="qs-dupe-warning" class="qs-dupe-warning hidden">
        ⚠ Already saved in this page — save anyway?
      </div>

      <div class="qs-actions">
        <button id="qs-save-btn" class="btn-purple">Save</button>
        <button id="qs-cancel-btn" class="btn-cancel-red">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const boardSelect = document.getElementById('qs-board-select');
  const pageSelect  = document.getElementById('qs-page-select');
  const dupeWarn    = document.getElementById('qs-dupe-warning');
  const saveBtn     = document.getElementById('qs-save-btn');
  const cancelBtn   = document.getElementById('qs-cancel-btn');

  // Populate boards
  DB.boards.getAll().then(boards => {
    boards.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.title;
      boardSelect.appendChild(opt);
    });
    if (boards.length) _loadPages(boards[0].id, pageSelect, tab.url, dupeWarn);
  });

  boardSelect.addEventListener('change', () => {
    _loadPages(boardSelect.value, pageSelect, tab.url, dupeWarn);
  });

  pageSelect.addEventListener('change', () => {
    _checkDupe(pageSelect.value, tab.url, dupeWarn);
  });

  saveBtn.addEventListener('click', async () => {
    const pageId = pageSelect.value;
    if (!pageId) return;
    await DB.bookmarks.create(pageId, {
      url: tab.url,
      title: tab.title,
      favicon: tab.favIconUrl || '',
      description: '',
      tags: []
    });
    _removePicker();
    // Trigger re-render in app
    window.dispatchEvent(new CustomEvent('boardtab:refresh'));
  });

  cancelBtn.addEventListener('click', _removePicker);
  overlay.addEventListener('click', e => { if (e.target === overlay) _removePicker(); });
}

async function _loadPages(boardId, selectEl, url, dupeWarn) {
  selectEl.innerHTML = '';
  const pages = await DB.pages.getForBoard(boardId);
  pages.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.title;
    selectEl.appendChild(opt);
  });
  if (pages.length) _checkDupe(pages[0].id, url, dupeWarn);
}

async function _checkDupe(pageId, url, dupeWarn) {
  if (!pageId) return;
  const dupes = await DB.bookmarks.findByUrl(url, pageId);
  dupeWarn.classList.toggle('hidden', dupes.length === 0);
}

function _removePicker() {
  const el = document.getElementById('qs-overlay');
  if (el) el.remove();
}

function _esc(str) {
  return (str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
