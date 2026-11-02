// Board Tab — IndexedDB Layer
// Schema version: 1
// Stores: boards, pages, bookmarks, settings

const DB_NAME = 'BoardTabDB';
const DB_VERSION = 1;

let _db = null;

// ─────────────────────────────────────────────
// Init & Migration
// ─────────────────────────────────────────────
function _uuid(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return prefix + '_' + crypto.randomUUID();
  }
  return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
}

export function init() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;

      // boards store
      if (!db.objectStoreNames.contains('boards')) {
        const bs = db.createObjectStore('boards', { keyPath: 'id' });
        bs.createIndex('order', 'order', { unique: false });
      }

      // pages store
      if (!db.objectStoreNames.contains('pages')) {
        const ps = db.createObjectStore('pages', { keyPath: 'id' });
        ps.createIndex('board_id', 'board_id', { unique: false });
        ps.createIndex('order', 'order', { unique: false });
      }

      // bookmarks store
      if (!db.objectStoreNames.contains('bookmarks')) {
        const bks = db.createObjectStore('bookmarks', { keyPath: 'id' });
        bks.createIndex('page_id', 'page_id', { unique: false });
        bks.createIndex('url', 'url', { unique: false });
        bks.createIndex('trashed_at', 'trashed_at', { unique: false });
        bks.createIndex('order', 'order', { unique: false });
      }

      // settings store (key-value)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };

    req.onsuccess = async (e) => {
      _db = e.target.result;
      await _migrateFromLocalStorage(_db);
      resolve(_db);
    };

    req.onerror = () => reject(req.error);
  });
}

async function _ensureDb() {
  if (!_db) {
    await init();
  }
  return _db;
}

// Migrate existing chrome.storage.local customBoards on first run
async function _migrateFromLocalStorage(db) {
  try {
    const migrated = await _idbRead(db, 'settings', 'migrated_v1');
    if (migrated && migrated.value) return;

    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      await _idbWrite(db, 'settings', { key: 'migrated_v1', value: true });
      return;
    }

    const stored = await new Promise(r =>
      chrome.storage.local.get(['customBoards', 'columnOrder', 'customBg'], res => r(res || {}))
    );

    const boards = stored.customBoards || [];
    const order = stored.columnOrder || [];
    const existingBg = stored.customBg || null;

    if (existingBg) {
      await _idbWrite(db, 'settings', { key: 'global_wallpaper', value: existingBg });
    }

    for (let i = 0; i < boards.length; i++) {
      const board = boards[i];
      const boardId = board.id || _uuid('board');
      const boardOrder = order.indexOf(boardId) !== -1 ? order.indexOf(boardId) : i + 100;

      await _idbWrite(db, 'boards', {
        id: boardId,
        title: board.title,
        icon: '',
        order: boardOrder,
        wallpaper_ref: null,
        accent_color: null,
        trashed_at: null
      });

      const pageId = _uuid('page');
      await _idbWrite(db, 'pages', {
        id: pageId,
        board_id: boardId,
        title: 'General',
        order: 0
      });

      for (let j = 0; j < (board.items || []).length; j++) {
        const item = board.items[j];
        await _idbWrite(db, 'bookmarks', {
          id: item.id || _uuid('bk'),
          page_id: pageId,
          url: item.url,
          title: item.title || item.url,
          favicon: '',
          description: '',
          tags: [],
          created_at: Date.now(),
          updated_at: Date.now(),
          order: j,
          trashed_at: null
        });
      }
    }

    if (order.length) {
      await _idbWrite(db, 'settings', { key: 'column_order', value: order });
    }

    await _idbWrite(db, 'settings', { key: 'migrated_v1', value: true });
  } catch (err) {
    console.warn('LocalStorage migration skipped:', err);
  }
}

// ─────────────────────────────────────────────
// Generic IDB helpers (safe auto-initialization)
// ─────────────────────────────────────────────
async function _idbWrite(db, store, data) {
  const activeDb = db || await _ensureDb();
  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(data);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function _idbRead(db, store, key) {
  const activeDb = db || await _ensureDb();
  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

async function _idbDelete(db, store, key) {
  const activeDb = db || await _ensureDb();
  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

async function _idbGetAll(db, store) {
  const activeDb = db || await _ensureDb();
  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function _idbGetByIndex(db, store, indexName, value) {
  const activeDb = db || await _ensureDb();
  return new Promise((resolve, reject) => {
    const tx = activeDb.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(indexName).getAll(value);
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ─────────────────────────────────────────────
// Public API namespace
// ─────────────────────────────────────────────
export const DB = {
  // ── Boards ──────────────────────────────────
  boards: {
    getAll: () => _idbGetAll(_db, 'boards').then(r => r.filter(b => !b.trashed_at).sort((a, b) => a.order - b.order)),
    getTrashed: () => _idbGetAll(_db, 'boards').then(r => r.filter(b => !!b.trashed_at)),
    get: (id) => _idbRead(_db, 'boards', id),
    save: (board) => _idbWrite(_db, 'boards', board),
    async softDelete(id) {
      const board = await DB.boards.get(id);
      if (board) {
        board.trashed_at = Date.now();
        await DB.boards.save(board);
      }
    },
    async restore(id) {
      const board = await DB.boards.get(id);
      if (board) {
        board.trashed_at = null;
        await DB.boards.save(board);
      }
    },
    hardDelete: (id) => _idbDelete(_db, 'boards', id),
    async create(title) {
      const all = await DB.boards.getAll();
      const board = {
        id: _uuid('board'),
        title,
        icon: '',
        order: (all.length ? Math.max(...all.map(b => b.order)) + 1 : 0),
        wallpaper_ref: null,
        accent_color: null,
        trashed_at: null
      };
      await _idbWrite(_db, 'boards', board);
      return board;
    },
    async reorder(ids) {
      for (let i = 0; i < ids.length; i++) {
        const board = await DB.boards.get(ids[i]);
        if (board) { board.order = i; await DB.boards.save(board); }
      }
    }
  },

  // ── Pages ────────────────────────────────────
  pages: {
    getAll: () => _idbGetAll(_db, 'pages'),
    getForBoard: (boardId) =>
      _idbGetByIndex(_db, 'pages', 'board_id', boardId).then(r => r.sort((a, b) => a.order - b.order)),
    get: (id) => _idbRead(_db, 'pages', id),
    save: (page) => _idbWrite(_db, 'pages', page),
    delete: async (id) => {
      // cascade delete bookmarks on this page
      const bks = await DB.bookmarks.getForPage(id);
      for (const bk of bks) await _idbDelete(_db, 'bookmarks', bk.id);
      await _idbDelete(_db, 'pages', id);
    },
    async create(boardId, title) {
      const existing = await DB.pages.getForBoard(boardId);
      const page = {
        id: _uuid('page'),
        board_id: boardId,
        title,
        order: existing.length ? Math.max(...existing.map(p => p.order)) + 1 : 0
      };
      await _idbWrite(_db, 'pages', page);
      return page;
    },
    async reorder(boardId, ids) {
      for (let i = 0; i < ids.length; i++) {
        const page = await DB.pages.get(ids[i]);
        if (page) { page.order = i; await DB.pages.save(page); }
      }
    }
  },

  // ── Bookmarks ────────────────────────────────
  bookmarks: {
    getForPage: (pageId) =>
      _idbGetByIndex(_db, 'bookmarks', 'page_id', pageId).then(r =>
        r.filter(b => !b.trashed_at).sort((a, b) => a.order - b.order)
      ),
    getAll: () => _idbGetAll(_db, 'bookmarks'),
    getAllActive: () => _idbGetAll(_db, 'bookmarks').then(r => r.filter(b => !b.trashed_at)),
    getTrashed: () => _idbGetAll(_db, 'bookmarks').then(r => r.filter(b => !!b.trashed_at)),
    get: (id) => _idbRead(_db, 'bookmarks', id),
    save: (bk) => _idbWrite(_db, 'bookmarks', bk),
    async create(pageId, { url, title, favicon = '', description = '', tags = [] }) {
      const existing = await DB.bookmarks.getForPage(pageId);
      const bk = {
        id: _uuid('bk'),
        page_id: pageId,
        url,
        title: title || url,
        favicon,
        description,
        tags,
        created_at: Date.now(),
        updated_at: Date.now(),
        order: existing.length ? Math.max(...existing.map(b => b.order)) + 1 : 0,
        trashed_at: null
      };
      await _idbWrite(_db, 'bookmarks', bk);
      return bk;
    },
    async softDelete(id) {
      const bk = await DB.bookmarks.get(id);
      if (bk) { bk.trashed_at = Date.now(); await DB.bookmarks.save(bk); }
    },
    async restore(id) {
      const bk = await DB.bookmarks.get(id);
      if (bk) { bk.trashed_at = null; bk.updated_at = Date.now(); await DB.bookmarks.save(bk); }
    },
    hardDelete: (id) => _idbDelete(_db, 'bookmarks', id),
    async purgeExpired() {
      const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const trashed = await DB.bookmarks.getTrashed();
      for (const bk of trashed) {
        if (bk.trashed_at < thirtyDaysAgo) await _idbDelete(_db, 'bookmarks', bk.id);
      }
    },
    async findByUrl(url, pageId = null) {
      const all = await DB.bookmarks.getAll();
      return all.filter(b => b.url === url && !b.trashed_at && (!pageId || b.page_id === pageId));
    },
    async reorder(pageId, ids) {
      for (let i = 0; i < ids.length; i++) {
        const bk = await DB.bookmarks.get(ids[i]);
        if (bk) { bk.order = i; await DB.bookmarks.save(bk); }
      }
    }
  },

  // ── Settings ─────────────────────────────────
  settings: {
    get: (key) => _idbRead(_db, 'settings', key).then(r => r ? r.value : null),
    set: (key, value) => _idbWrite(_db, 'settings', { key, value }),
    async getAll() {
      const rows = await _idbGetAll(_db, 'settings');
      return Object.fromEntries(rows.map(r => [r.key, r.value]));
    }
  }
};
