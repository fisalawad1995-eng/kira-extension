// Board Tab — Export Module
// JSON export/import for boards and pages with round-trip compatibility.

import { DB } from '../db/indexeddb.js';

const EXPORT_VERSION = 1;

// ─────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────

/**
 * Export a complete board (all pages + bookmarks) as a JSON blob download.
 */
export async function exportBoard(boardId) {
  const board = await DB.boards.get(boardId);
  if (!board) throw new Error('Board not found: ' + boardId);

  const pages = await DB.pages.getForBoard(boardId);
  const pagesWithBookmarks = [];
  for (const page of pages) {
    const bookmarks = await DB.bookmarks.getForPage(page.id);
    pagesWithBookmarks.push({ ...page, bookmarks });
  }

  const payload = {
    _boardtab_export_version: EXPORT_VERSION,
    type: 'board',
    exported_at: new Date().toISOString(),
    board: { ...board },
    pages: pagesWithBookmarks
  };

  _downloadJson(payload, `BoardTab_${_slug(board.title)}_${_dateStamp()}.json`);
}

/**
 * Export a single page as a JSON blob download.
 */
export async function exportPage(pageId) {
  const page = await DB.pages.get(pageId);
  if (!page) throw new Error('Page not found: ' + pageId);

  const board = await DB.boards.get(page.board_id);
  const bookmarks = await DB.bookmarks.getForPage(pageId);

  const payload = {
    _boardtab_export_version: EXPORT_VERSION,
    type: 'page',
    exported_at: new Date().toISOString(),
    board_title: board?.title || '',
    page: { ...page },
    bookmarks
  };

  _downloadJson(payload, `BoardTab_${_slug(page.title)}_${_dateStamp()}.json`);
}

// ─────────────────────────────────────────────
// Import from JSON
// ─────────────────────────────────────────────

/**
 * Import a board or page from a Board Tab JSON file.
 * Returns a summary { boardId, pagesImported, bookmarksImported, duplicatesSkipped }
 */
export async function importFromJson(json) {
  let data;
  try {
    data = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('Invalid JSON file format.');
  }

  // Case 1: Native Board Tab export file
  if (data._boardtab_export_version || data.type === 'board' || data.type === 'page' || data.board || data.page) {
    if (data.type === 'board' || data.board) {
      return _importBoard(data);
    } else if (data.type === 'page' || data.page) {
      return _importPage(data);
    }
  }

  // Case 2: Chrome / Firefox / Generic Bookmark JSON
  return _importGenericJson(data);
}

async function _importGenericJson(data) {
  const items = [];
  function extract(node, folderName = 'Imported') {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(n => extract(n, folderName));
      return;
    }
    if (typeof node === 'object') {
      if (node.url) {
        items.push({
          title: node.title || node.name || node.url,
          url: node.url,
          folder: node.folder || node.category || folderName
        });
      }
      const children = node.children || node.bookmarks || node.items;
      if (Array.isArray(children)) {
        extract(children, node.title || node.name || folderName);
      }
    }
  }

  extract(data);

  if (!items.length) {
    throw new Error('No valid bookmark URLs found in JSON file.');
  }

  const newBoard = await DB.boards.create('Imported Bookmarks');
  const pageMap = {};
  let bookmarksImported = 0;
  let duplicatesSkipped = 0;

  for (const item of items) {
    const fName = item.folder || 'General';
    if (!pageMap[fName]) {
      const page = await DB.pages.create(newBoard.id, fName);
      pageMap[fName] = page.id;
    }
    const pageId = pageMap[fName];

    const dupes = await DB.bookmarks.findByUrl(item.url, pageId);
    if (dupes.length > 0) {
      duplicatesSkipped++;
      continue;
    }

    await DB.bookmarks.create(pageId, {
      url: item.url,
      title: item.title,
      favicon: ''
    });
    bookmarksImported++;
  }

  return {
    boardId: newBoard.id,
    pagesImported: Object.keys(pageMap).length,
    bookmarksImported,
    duplicatesSkipped
  };
}

async function _importBoard(data) {
  // Create new board (new IDs to avoid conflicts)
  const newBoard = await DB.boards.create(data.board.title + ' (imported)');
  newBoard.icon = data.board.icon || '';
  newBoard.accent_color = data.board.accent_color || null;
  await DB.boards.save(newBoard);

  let pagesImported = 0;
  let bookmarksImported = 0;
  let duplicatesSkipped = 0;

  for (const pageData of (data.pages || [])) {
    const newPage = await DB.pages.create(newBoard.id, pageData.title);

    for (const bk of (pageData.bookmarks || [])) {
      const dupes = await DB.bookmarks.findByUrl(bk.url, newPage.id);
      if (dupes.length > 0) { duplicatesSkipped++; continue; }

      await DB.bookmarks.create(newPage.id, {
        url: bk.url,
        title: bk.title,
        favicon: bk.favicon || '',
        description: bk.description || '',
        tags: bk.tags || []
      });
      bookmarksImported++;
    }
    pagesImported++;
  }

  return { boardId: newBoard.id, pagesImported, bookmarksImported, duplicatesSkipped };
}

async function _importPage(data) {
  // Append to an existing board or create a new one? We create new board for simplicity.
  const newBoard = await DB.boards.create(data.board_title ? data.board_title + ' (imported)' : 'Imported');
  const newPage  = await DB.pages.create(newBoard.id, data.page.title);

  let bookmarksImported = 0;
  let duplicatesSkipped = 0;

  for (const bk of (data.bookmarks || [])) {
    const dupes = await DB.bookmarks.findByUrl(bk.url, newPage.id);
    if (dupes.length > 0) { duplicatesSkipped++; continue; }
    await DB.bookmarks.create(newPage.id, {
      url: bk.url,
      title: bk.title,
      favicon: bk.favicon || '',
      description: bk.description || '',
      tags: bk.tags || []
    });
    bookmarksImported++;
  }

  return { boardId: newBoard.id, pagesImported: 1, bookmarksImported, duplicatesSkipped };
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function _downloadJson(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function _slug(str) {
  return (str || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function _dateStamp() {
  return new Date().toISOString().slice(0, 10);
}
