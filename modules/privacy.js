// Board Tab — Privacy Module
// Blur toggle, per-bookmark soft-delete (Trash), and Incognito open.

import { DB } from '../db/indexeddb.js';

// ─────────────────────────────────────────────
// Blur Mode
// ─────────────────────────────────────────────
let _blurEnabled = false;

export async function initBlur() {
  _blurEnabled = (await DB.settings.get('blur_enabled')) || false;
  _applyBlurState();
}

export async function toggleBlur() {
  _blurEnabled = !_blurEnabled;
  await DB.settings.set('blur_enabled', _blurEnabled);
  _applyBlurState();
  return _blurEnabled;
}

export function isBlurEnabled() {
  return _blurEnabled;
}

function _applyBlurState() {
  const ws = document.getElementById('workspace-container');
  if (!ws) return;
  if (_blurEnabled) {
    ws.classList.add('blur-active');
  } else {
    ws.classList.remove('blur-active');
    // Remove any temporary reveals
    document.querySelectorAll('.board-column.blur-revealed').forEach(el => {
      el.classList.remove('blur-revealed');
    });
  }
}

// Clicking a blurred column temporarily reveals it
export function attachBlurReveal(columnEl) {
  columnEl.addEventListener('click', (e) => {
    if (!_blurEnabled) return;
    if (columnEl.classList.contains('blur-revealed')) return;
    e.preventDefault();
    e.stopPropagation();
    columnEl.classList.add('blur-revealed');
    // Auto-hide after 5 seconds
    setTimeout(() => columnEl.classList.remove('blur-revealed'), 5000);
  }, true);
}

// ─────────────────────────────────────────────
// Trash
// ─────────────────────────────────────────────
export async function purgeExpiredTrash() {
  await DB.bookmarks.purgeExpired();
}

export async function getTrashItems() {
  return DB.bookmarks.getTrashed();
}

export async function getTrashedBoards() {
  return DB.boards.getTrashed();
}

export async function softDeleteBoard(boardId) {
  await DB.boards.softDelete(boardId);
}

export async function restoreBoardFromTrash(boardId) {
  await DB.boards.restore(boardId);
}

export async function permanentlyDeleteBoard(boardId) {
  const pages = await DB.pages.getForBoard(boardId);
  for (const page of pages) {
    await DB.pages.delete(page.id);
  }
  await DB.boards.hardDelete(boardId);
}

export async function restoreFromTrash(bookmarkId) {
  await DB.bookmarks.restore(bookmarkId);
}

export async function permanentlyDelete(bookmarkId) {
  await DB.bookmarks.hardDelete(bookmarkId);
}

// ─────────────────────────────────────────────
// Incognito — called from service worker context
// (kept here as a utility the service worker imports)
// ─────────────────────────────────────────────
export function openInIncognito(url) {
  chrome.windows.create({ url, incognito: true });
}
