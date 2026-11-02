// Board Tab — Bulk Import Module
// Chrome native bookmarks + Netscape .html import with de-dupe and chunk processing.

import { DB } from '../db/indexeddb.js';

const CHUNK_SIZE = 100;

// ─────────────────────────────────────────────
// Progress callback type
// onProgress({ done, total, duplicates }) — called after each chunk
// ─────────────────────────────────────────────

/**
 * Import from Chrome's native bookmark tree.
 * Maps: Bookmark Bar top-level folders → Boards; subfolders → Pages; leaves → Bookmarks.
 */
export async function importFromChromeBookmarks(onProgress) {
  const tree = await new Promise(r => chrome.bookmarks.getTree(r));
  const topFolders = _getTopFolders(tree);

  const queue = []; // flat list of {boardTitle, pageTitle, url, title}

  for (const folder of topFolders) {
    _walkFolder(folder, folder.title, null, queue);
  }

  return _processQueue(queue, onProgress);
}

/**
 * Import from a Netscape HTML bookmark file (standard export from any browser).
 */
export async function importFromHtmlFile(file, onProgress) {
  const text = await file.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(text, 'text/html');

  const queue = [];
  _walkHtmlDl(doc.querySelector('dl'), 'Imported', null, queue);

  return _processQueue(queue, onProgress);
}

// ─────────────────────────────────────────────
// Walk helpers
// ─────────────────────────────────────────────
function _getTopFolders(tree) {
  const root = tree[0];
  const allTop = [];
  for (const child of (root.children || [])) {
    for (const sub of (child.children || [])) {
      if (sub.children) allTop.push(sub); // these are the real named folders
    }
  }
  // Fallback: if no nested structure, use root children directly
  if (!allTop.length) {
    for (const child of (root.children || [])) {
      if (child.children) allTop.push(child);
    }
  }
  return allTop;
}

function _walkFolder(node, boardTitle, pageTitle, queue) {
  if (!node.children) {
    // It's a bookmark leaf
    if (node.url) {
      queue.push({ boardTitle, pageTitle: pageTitle || 'General', url: node.url, title: node.title || node.url });
    }
    return;
  }
  // It's a folder — becomes a page if nested, or stays as board if top-level
  const nextPageTitle = pageTitle === null ? null : (pageTitle || node.title);
  for (const child of node.children) {
    if (child.children) {
      // Nested folder → Page
      _walkFolder(child, boardTitle, child.title, queue);
    } else if (child.url) {
      queue.push({ boardTitle, pageTitle: nextPageTitle || 'General', url: child.url, title: child.title || child.url });
    }
  }
}

function _walkHtmlDl(dl, boardTitle, pageTitle, queue) {
  if (!dl) return;
  const children = [...dl.children];
  for (const child of children) {
    if (child.tagName === 'DT') {
      const h3 = child.querySelector(':scope > h3');
      const a  = child.querySelector(':scope > a');
      const subDl = child.querySelector(':scope > dl');
      if (h3) {
        // Folder heading → new page or board
        _walkHtmlDl(subDl, boardTitle, h3.textContent.trim(), queue);
      } else if (a && a.href) {
        queue.push({ boardTitle, pageTitle: pageTitle || 'General', url: a.href, title: a.textContent.trim() || a.href });
      }
    }
  }
}

// ─────────────────────────────────────────────
// Queue processor — chunked to keep UI responsive
// ─────────────────────────────────────────────
async function _processQueue(queue, onProgress) {
  // Build board/page cache to avoid duplicate DB reads
  const boardCache = {};   // title → board object
  const pageCache = {};    // `${boardId}::${pageTitle}` → page object
  const urlSet = new Set(); // existing URLs for de-dupe

  // Pre-load all existing bookmark URLs
  const existing = await DB.bookmarks.getAllActive();
  existing.forEach(b => urlSet.add(b.url));

  let bookmarksImported = 0;
  let duplicatesSkipped = 0;
  const conflicts = [];

  for (let i = 0; i < queue.length; i += CHUNK_SIZE) {
    const chunk = queue.slice(i, i + CHUNK_SIZE);

    for (const item of chunk) {
      // Resolve board
      if (!boardCache[item.boardTitle]) {
        const all = await DB.boards.getAll();
        let board = all.find(b => b.title === item.boardTitle);
        if (!board) board = await DB.boards.create(item.boardTitle);
        boardCache[item.boardTitle] = board;
      }
      const board = boardCache[item.boardTitle];

      // Resolve page
      const pageCacheKey = board.id + '::' + item.pageTitle;
      if (!pageCache[pageCacheKey]) {
        const pages = await DB.pages.getForBoard(board.id);
        let page = pages.find(p => p.title === item.pageTitle);
        if (!page) page = await DB.pages.create(board.id, item.pageTitle);
        pageCache[pageCacheKey] = page;
      }
      const page = pageCache[pageCacheKey];

      // De-dupe
      if (urlSet.has(item.url)) {
        duplicatesSkipped++;
        conflicts.push({ url: item.url, title: item.title });
        continue;
      }

      await DB.bookmarks.create(page.id, {
        url: item.url,
        title: item.title,
        favicon: '',
        description: '',
        tags: []
      });
      urlSet.add(item.url);
      bookmarksImported++;
    }

    // Yield to browser between chunks
    await new Promise(r => setTimeout(r, 0));

    if (onProgress) {
      onProgress({
        done: Math.min(i + CHUNK_SIZE, queue.length),
        total: queue.length,
        duplicates: duplicatesSkipped
      });
    }
  }

  return { bookmarksImported, duplicatesSkipped, conflicts };
}
