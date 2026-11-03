// Board Tab — Boards & Pages Module
// Renders board columns with page tabs. Extends existing D&D logic.
// Native bookmark folders remain flat (no pages).

import { DB } from '../db/indexeddb.js';
import { attachBlurReveal } from './privacy.js';
import { exportBoard, exportPage } from './export.js';
import { applyBoardWallpaper } from './theme.js';

// ─────────────────────────────────────────────
// State
// ─────────────────────────────────────────────
export let bookmarkDragState = null;
export let columnDragState = null;

// ─────────────────────────────────────────────
// Favicon helper (reused from original)
// ─────────────────────────────────────────────
export function getFaviconUrl(url) {
  try {
    const parsed = new URL(url);
    if (chrome?.runtime?.id) {
      return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=32`;
    }
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=32`;
  } catch { return ''; }
}

const MONOGRAM_PALETTES = [
  ['#8B5CF6', '#5B21B6'],
  ['#3B82F6', '#1D4ED8'],
  ['#10B981', '#047857'],
  ['#F59E0B', '#B45309'],
  ['#EC4899', '#BE185D'],
  ['#06B6D4', '#0E7490'],
  ['#F43F5E', '#BE123C'],
  ['#6366F1', '#4338CA']
];

function _buildMonogramSvgDataUrl(url) {
  let clean = 'BT';
  try {
    const host = new URL(url).hostname.replace(/^www\./i, '');
    const parts = host.split('.');
    const main = parts[0] || host;
    clean = main.slice(0, 2).toUpperCase();
  } catch {
    clean = (url || 'LK').replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase() || 'LK';
  }

  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = clean.charCodeAt(i) + ((hash << 5) - hash);
  }
  const [c1, c2] = MONOGRAM_PALETTES[Math.abs(hash) % MONOGRAM_PALETTES.length];

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${c1}"/>
        <stop offset="100%" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="32" height="32" rx="7" fill="url(#g)"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" font-family="Inter, sans-serif" font-weight="700" font-size="13" letter-spacing="0.5">${clean}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function createFaviconImg(url, className = 'favicon-img') {
  const img = document.createElement('img');
  img.className = className;
  img.alt = '';

  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { }
  const fallbackSrc = hostname ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32` : '';
  const monogramSrc = _buildMonogramSvgDataUrl(url);

  const primarySrc = getFaviconUrl(url);
  img.src = primarySrc || fallbackSrc || monogramSrc;

  img.addEventListener('error', function errorHandler() {
    if (!img.dataset.tried && fallbackSrc) {
      img.dataset.tried = '1';
      img.src = fallbackSrc;
    } else if (!img.dataset.monogram) {
      img.dataset.monogram = '1';
      img.src = monogramSrc;
    }
  });

  return img;
}

export function applyColumnAccent(column, hex) {
  if (hex) {
    column.style.setProperty('--board-accent', hex);
    column.classList.add('has-board-accent');
  } else {
    column.style.removeProperty('--board-accent');
    column.classList.remove('has-board-accent');
  }
}

export async function loadBoardPositions() {
  const key = layoutMode === 'grid' ? 'board_positions_grid' : 'board_positions';
  return (await DB.settings.get(key)) || {};
}

export async function saveBoardPosition(id, pos) {
  const key = layoutMode === 'grid' ? 'board_positions_grid' : 'board_positions';
  const positions = await loadBoardPositions();
  positions[id] = { ...(positions[id] || {}), ...pos };
  await DB.settings.set(key, positions);
}

export async function loadColumnOrder() {
  return (await DB.settings.get('column_order')) || [];
}

export async function saveColumnOrder(orderArr) {
  await DB.settings.set('column_order', orderArr);
}

export let maxZIndex = 100;
export function setMaxZIndex(z) {
  maxZIndex = Math.max(maxZIndex, z);
}

export let layoutMode = 'canvas';
export function setLayoutMode(mode) {
  layoutMode = mode;
}

// ─────────────────────────────────────────────
// Build Native Folder Column (unchanged logic, preserved)
// ─────────────────────────────────────────────
export function buildFolderColumn(title, folderId, items, handlers) {
  const column = document.createElement('div');
  column.className = 'board-column';
  column.dataset.columnType = 'folder';
  column.dataset.folderId = folderId;
  _attachCanvasDrag(column, folderId);
  attachBlurReveal(column);

  if (handlers.accentColor) {
    applyColumnAccent(column, handlers.accentColor);
  }

  const header = _buildHeader(title, {
    onAdd: handlers.onAdd,
    onOpenAll: (e) => handlers.onOpenAll(e?.shiftKey),
    onMore: (e, btn) => _showColumnMenu(e, btn, {
      onOpenAll: () => handlers.onOpenAll(false),
      onRename: handlers.onRename,
      onDelete: handlers.onDelete,
      deleteLabel: 'Delete Folder',
      onExportBoard: null, // folders don't support JSON export
      currentAccent: handlers.accentColor || null,
      onSelectAccent: async (hex) => {
        applyColumnAccent(column, hex);
        handlers.accentColor = hex;
        if (handlers.onSelectAccent) await handlers.onSelectAccent(hex);
      }
    })
  });
  column.appendChild(header);

  const list = document.createElement('div');
  list.className = 'bookmark-list';
  _attachListDropZone(list, column, { type: 'folder', folderId }, handlers.onReorder);

  items.forEach(item => list.appendChild(buildBookmarkRow(item.title, item.url, {
    itemType: 'folder', itemId: item.id, folderId,
    onDelete: () => {
      if (confirm('Remove?')) chrome.bookmarks.remove(item.id, handlers.onRefresh);
    }
  })));

  if (items.length === 0) list.appendChild(_buildEmptyState('No bookmarks yet'));
  column.appendChild(list);
  _attachResize(column, folderId);
  return column;
}

// ─────────────────────────────────────────────
// Build Custom Board Column with Page Tabs
// ─────────────────────────────────────────────
export function buildBoardColumn(board, pages, bookmarksByPage, handlers) {
  const column = document.createElement('div');
  column.className = 'board-column';
  column.dataset.columnType = 'custom';
  column.dataset.boardId = board.id;
  _attachCanvasDrag(column, board.id);
  attachBlurReveal(column);

  // Apply per-board color accent if set
  if (board.accent_color) {
    applyColumnAccent(column, board.accent_color);
  }

  const header = _buildHeader(board.title, {
    onAdd: () => handlers.onAddBookmark(board.id),
    onOpenAll: (e) => {
      const activeList = column.querySelector('.bookmark-list.active-page');
      if (activeList) _openAllInList(activeList, e?.shiftKey);
    },
    onMore: (e, btn) => _showColumnMenu(e, btn, {
      onOpenAll: () => {
        const activeList = column.querySelector('.bookmark-list.active-page');
        if (activeList) _openAllInList(activeList, false);
      },
      onRename: () => handlers.onRenameBoard(board.id, board.title),
      onDelete: () => handlers.onDeleteBoard(board.id),
      onExportBoard: () => exportBoard(board.id),
      onAddPage: () => handlers.onAddPage(board.id),
      onImportJson: () => handlers.onImportJson(),
      currentAccent: board.accent_color || null,
      onSelectAccent: async (hex) => {
        board.accent_color = hex;
        await DB.boards.save(board);
        applyColumnAccent(column, hex);
      }
    })
  });
  column.appendChild(header);

  // Page Tabs
  const tabBar = document.createElement('div');
  tabBar.className = 'page-tab-bar';

  pages.forEach((page, idx) => {
    const tab = document.createElement('button');
    tab.className = 'page-tab' + (idx === 0 ? ' active' : '');
    tab.dataset.pageId = page.id;
    tab.innerHTML = `<span class="page-tab-label">${_esc(page.title)}</span>`;
    tab.addEventListener('click', () => _activateTab(column, page.id));

    // Tab right-click context
    tab.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      _showPageTabMenu(e, page, board.id, handlers);
    });

    tabBar.appendChild(tab);
  });

  // Add page button
  const addPageBtn = document.createElement('button');
  addPageBtn.className = 'page-tab-add';
  addPageBtn.title = 'Add page';
  addPageBtn.innerHTML = '+';
  addPageBtn.addEventListener('click', () => handlers.onAddPage(board.id));
  tabBar.appendChild(addPageBtn);
  column.appendChild(tabBar);

  // Page content (one bookmark-list per page, only first is visible)
  pages.forEach((page, idx) => {
    const list = document.createElement('div');
    list.className = 'bookmark-list' + (idx === 0 ? ' active-page' : ' hidden-page');
    list.dataset.pageId = page.id;
    _attachListDropZone(list, column, { type: 'custom', boardId: board.id, pageId: page.id }, handlers.onReorder);

    const items = bookmarksByPage[page.id] || [];
    items.forEach(item => list.appendChild(buildBookmarkRow(item.title, item.url, {
      itemType: 'custom', itemId: item.id, boardId: board.id, pageId: page.id,
      onDelete: async () => {
        await DB.bookmarks.softDelete(item.id);
        handlers.onRefresh();
      }
    })));

    if (items.length === 0) list.appendChild(_buildEmptyState('No bookmarks — add one with +'));
    column.appendChild(list);
  });

  if (pages.length === 0) {
    const emptyBoard = _buildEmptyState('No pages yet');
    const addFirstPage = document.createElement('button');
    addFirstPage.className = 'btn-add-first-page';
    addFirstPage.textContent = '+ Add a page';
    addFirstPage.addEventListener('click', () => handlers.onAddPage(board.id));
    emptyBoard.appendChild(addFirstPage);
    column.appendChild(emptyBoard);
  }

  _attachResize(column, board.id);
  return column;
}

function _activateTab(columnEl, pageId) {
  columnEl.querySelectorAll('.page-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.pageId === pageId);
  });
  columnEl.querySelectorAll('.bookmark-list[data-page-id]').forEach(l => {
    if (l.dataset.pageId === pageId) {
      l.classList.add('active-page');
      l.classList.remove('hidden-page');
    } else {
      l.classList.remove('active-page');
      l.classList.add('hidden-page');
    }
  });
}

// ─────────────────────────────────────────────
// Bookmark Row (extended original)
// ─────────────────────────────────────────────
export function buildBookmarkRow(title, url, opts) {
  const wrapper = document.createElement('div');
  wrapper.className = 'bookmark-item';
  wrapper.draggable = true;

  const link = document.createElement('a');
  link.className = 'bookmark-link-content';
  link.href = url;
  link.target = '_blank';

  const faviconImg = createFaviconImg(url, 'favicon-img');
  const titleSpan = document.createElement('span');
  titleSpan.className = 'bookmark-title';
  titleSpan.textContent = title || url;

  link.appendChild(faviconImg);
  link.appendChild(titleSpan);

  const actions = document.createElement('div');
  actions.className = 'item-actions';
  actions.innerHTML = `<button class="item-action-btn delete" title="Move to Trash">✖</button>`;
  actions.querySelector('.delete').addEventListener('click', (e) => {
    e.preventDefault();
    opts.onDelete();
  });

  wrapper.appendChild(link);
  wrapper.appendChild(actions);

  wrapper.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    _showBookmarkRowMenu(e, { title, url, opts });
  });

  wrapper.addEventListener('dragstart', (e) => {
    e.stopPropagation();
    bookmarkDragState = {
      itemId: opts.itemId, itemType: opts.itemType, title, url,
      sourceFolderId: opts.folderId || null,
      sourceBoardId: opts.boardId || null,
      sourcePageId: opts.pageId || null
    };
    setTimeout(() => wrapper.classList.add('dragging'), 0);
  });
  wrapper.addEventListener('dragend', () => {
    wrapper.classList.remove('dragging');
    bookmarkDragState = null;
  });
  return wrapper;
}

// ─────────────────────────────────────────────
// Column D&D (preserved from original)
// ─────────────────────────────────────────────
function _attachCanvasDrag(column, identifier) {
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;
  let clone = null;
  let initialRect = null;
  let cols = [];

  column.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const header = e.target.closest('.board-column-header-handle');
    if (!header) return;
    if (e.target.closest('button') || e.target.closest('.page-tab')) return;

    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;

    if (layoutMode === 'canvas') {
      initialLeft = parseInt(column.style.left || '0', 10);
      initialTop = parseInt(column.style.top || '0', 10);
      maxZIndex++;
      column.style.zIndex = maxZIndex;
      column.classList.add('dragging-column');
    } else {
      // Grid mode smooth swapping setup
      initialRect = column.getBoundingClientRect();
      const workspace = column.parentElement;
      cols = [...workspace.querySelectorAll('.board-column')];

      // Create a hidden placeholder clone so CSS columns don't reflow instantly
      clone = column.cloneNode(true);
      clone.style.opacity = '0';
      workspace.insertBefore(clone, column);

      // Pull original out of normal flow
      column.style.position = 'fixed';
      column.style.left = `${initialRect.left}px`;
      column.style.top = `${initialRect.top}px`;
      column.style.width = `${initialRect.width}px`;
      column.style.zIndex = 9999;
      column.style.margin = '0';
      column.classList.add('dragging-column');
    }

    column.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  column.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (layoutMode === 'canvas') {
      const GRID_SIZE = 20;
      const rawLeft = initialLeft + dx;
      const rawTop = initialTop + dy;
      column.style.left = `${Math.round(rawLeft / GRID_SIZE) * GRID_SIZE}px`;
      column.style.top = `${Math.round(rawTop / GRID_SIZE) * GRID_SIZE}px`;
    } else {
      // Grid mode absolute movement
      column.style.left = `${initialRect.left + dx}px`;
      column.style.top = `${initialRect.top + dy}px`;

      // Calculate intersection
      const x = e.clientX;
      const y = e.clientY;
      const workspace = column.parentElement;
      const elements = [...workspace.querySelectorAll('.board-column:not(.dragging-column)')];

      let hoveredEl = null;
      for (const el of elements) {
        if (el === clone) continue;
        const rect = el.getBoundingClientRect();
        // 20px buffer to prevent rapid boundary flickering
        if (x > rect.left + 20 && x < rect.right - 20 && y > rect.top + 20 && y < rect.bottom - 20) {
          hoveredEl = el;
          break;
        }
      }

      if (hoveredEl) {
        const all = [...workspace.querySelectorAll('.board-column')];
        const cloneIdx = all.indexOf(clone);
        const hoverIdx = all.indexOf(hoveredEl);

        // FLIP: First
        const firstRects = new Map();
        all.forEach(el => {
          if (el !== column) firstRects.set(el, el.getBoundingClientRect());
        });

        if (cloneIdx < hoverIdx) {
          workspace.insertBefore(clone, hoveredEl.nextSibling);
        } else {
          workspace.insertBefore(clone, hoveredEl);
        }

        // FLIP: Last, Invert, Play
        all.forEach(el => {
          if (el === clone || el === column) return;
          const first = firstRects.get(el);
          const last = el.getBoundingClientRect();
          if (!first) return;

          const dx = first.left - last.left;
          const dy = first.top - last.top;

          if (dx !== 0 || dy !== 0) {
            el.style.transform = `translate(${dx}px, ${dy}px)`;
            el.style.transition = 'none';
            requestAnimationFrame(() => {
              el.style.transform = '';
              el.style.transition = 'transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)';
            });
          }
        });
      }
    }
  });

  const stopDrag = async (e) => {
    if (!isDragging) return;
    isDragging = false;
    column.releasePointerCapture(e.pointerId);
    column.classList.remove('dragging-column');

    const isClick = Math.abs(e.clientX - startX) < 5 && Math.abs(e.clientY - startY) < 5;

    if (layoutMode === 'canvas') {
      if (!isClick) {
        saveBoardPosition(identifier, {
          x: parseInt(column.style.left || '0', 10),
          y: parseInt(column.style.top || '0', 10),
          zIndex: parseInt(column.style.zIndex || '100', 10)
        });
      }
    } else {
      // Grid mode drop
      const workspace = column.parentElement;
      column.style.position = '';
      column.style.left = '';
      column.style.top = '';
      column.style.width = '';
      column.style.zIndex = '';
      column.style.margin = '';

      if (clone && clone.parentNode) {
        workspace.insertBefore(column, clone);
        clone.remove();
      }

      if (!isClick) {
        // Save new order
        const newOrder = [...workspace.querySelectorAll('.board-column')].map(col => col.dataset.folderId || col.dataset.boardId);
        await saveColumnOrder(newOrder);
      }
    }

    if (isClick) {
      column.classList.toggle('collapsed');
    }
  };

  column.addEventListener('pointerup', stopDrag);
  column.addEventListener('pointercancel', stopDrag);
}

// ─────────────────────────────────────────────
// Bookmark D&D (Internal & External Browser URL Drops)
// ─────────────────────────────────────────────
function _isExternalLinkDrag(e) {
  if (bookmarkDragState) return false;
  const types = e.dataTransfer?.types ? [...e.dataTransfer.types] : [];
  return types.includes('text/uri-list') || types.includes('text/plain') || types.includes('text/html');
}

function _extractExternalLinkData(dt) {
  if (!dt) return null;
  let url = '';
  let title = '';

  // Try HTML first to extract both <a href="..."> and anchor text
  const html = dt.getData('text/html');
  if (html) {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const a = doc.querySelector('a[href]');
      if (a) {
        url = a.getAttribute('href') || '';
        title = (a.textContent || '').trim();
      }
    } catch {}
  }

  // Fallback to text/uri-list or text/plain
  if (!url) {
    const uriList = dt.getData('text/uri-list');
    if (uriList) {
      const lines = uriList.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const validLine = lines.find(l => !l.startsWith('#'));
      if (validLine) url = validLine;
    }
  }

  if (!url) {
    const plain = (dt.getData('text/plain') || '').trim();
    if (/^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(plain) && !/\s/.test(plain)) {
      url = /^https?:\/\//i.test(plain) ? plain : 'https://' + plain;
    }
  }

  if (!url || /^javascript:/i.test(url)) return null;
  if (!/^https?:\/\//i.test(url) && !/^chrome-extension:\/\//i.test(url)) return null;

  if (!title) {
    try { title = new URL(url).hostname.replace(/^www\./, ''); } catch { title = url; }
  }
  return { url, title };
}

function _attachListDropZone(listEl, columnEl, target, onReorder) {
  const _clearItemDropIndicators = () => {
    listEl.querySelectorAll('.bookmark-item').forEach(i => i.classList.remove('drag-over-top', 'drag-over-bottom'));
  };

  listEl.addEventListener('dragover', (e) => {
    if (!bookmarkDragState && !_isExternalLinkDrag(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = bookmarkDragState ? 'move' : 'copy';
    columnEl.classList.add('drop-target');

    _clearItemDropIndicators();
    const afterEl = _getDragAfterItem(listEl, e.clientY);
    if (afterEl) {
      afterEl.classList.add('drag-over-top');
    } else {
      const items = listEl.querySelectorAll('.bookmark-item:not(.dragging)');
      if (items.length) items[items.length - 1].classList.add('drag-over-bottom');
    }
  });

  listEl.addEventListener('dragleave', (e) => {
    if (!listEl.contains(e.relatedTarget)) {
      columnEl.classList.remove('drop-target');
      _clearItemDropIndicators();
    }
  });

  listEl.addEventListener('drop', async (e) => {
    e.preventDefault();
    columnEl.classList.remove('drop-target');
    _clearItemDropIndicators();

    const afterEl = _getDragAfterItem(listEl, e.clientY);
    const siblings = [...listEl.querySelectorAll('.bookmark-item:not(.dragging)')];
    const dropIndex = afterEl ? siblings.indexOf(afterEl) : siblings.length;

    // Case 1: External link dragged from browser/address bar/webpage
    if (!bookmarkDragState) {
      const extData = _extractExternalLinkData(e.dataTransfer);
      if (!extData) return;

      if (target.type === 'folder') {
        await new Promise(r => chrome.bookmarks.create({
          parentId: target.folderId,
          title: extData.title,
          url: extData.url,
          index: dropIndex
        }, r));
      } else if (target.type === 'custom') {
        const created = await DB.bookmarks.create(target.pageId, {
          url: extData.url,
          title: extData.title,
          favicon: getFaviconUrl(extData.url)
        });
        const existingInPage = await DB.bookmarks.getForPage(target.pageId);
        const filtered = existingInPage.filter(b => b.id !== created.id);
        const clampedIndex = Math.max(0, Math.min(dropIndex, filtered.length));
        filtered.splice(clampedIndex, 0, created);
        for (let i = 0; i < filtered.length; i++) {
          filtered[i].order = i;
          await DB.bookmarks.save(filtered[i]);
        }
      }
      if (onReorder) onReorder();
      return;
    }

    // Case 2: Internal bookmark drag & drop
    const source = { ...bookmarkDragState };
    bookmarkDragState = null;

    if (source.itemType === 'folder' && target.type === 'folder') {
      await new Promise(r => chrome.bookmarks.move(source.itemId, { parentId: target.folderId, index: dropIndex }, r));
    } else if (source.itemType === 'folder' && target.type === 'custom') {
      await DB.bookmarks.create(target.pageId, { url: source.url, title: source.title });
    } else if (source.itemType === 'custom' && target.type === 'custom') {
      const existingInPage = await DB.bookmarks.getForPage(target.pageId);
      const filtered = existingInPage.filter(b => b.id !== source.itemId);
      const draggedBk = await DB.bookmarks.get(source.itemId);
      if (draggedBk) {
        draggedBk.page_id = target.pageId;
        const clampedIndex = Math.max(0, Math.min(dropIndex, filtered.length));
        filtered.splice(clampedIndex, 0, draggedBk);
        for (let i = 0; i < filtered.length; i++) {
          filtered[i].order = i;
          await DB.bookmarks.save(filtered[i]);
        }
      }
    } else if (source.itemType === 'custom' && target.type === 'folder') {
      await new Promise(r => chrome.bookmarks.create({ parentId: target.folderId, title: source.title, url: source.url }, r));
      await DB.bookmarks.softDelete(source.itemId);
    }

    if (onReorder) onReorder();
  });
}

function _getDragAfterItem(container, y) {
  const items = [...container.querySelectorAll('.bookmark-item:not(.dragging)')];
  return items.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > closest.offset) return { offset, element: child };
    return closest;
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// ─────────────────────────────────────────────
// Board Header
// ─────────────────────────────────────────────
function _buildHeader(title, actions) {
  const header = document.createElement('div');
  header.className = 'board-header board-column-header-handle';
  header.title = 'Drag to move column (Right-click for options)';
  header.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (actions.onMore) actions.onMore(e, header);
  });

  const titleEl = document.createElement('span');
  titleEl.className = 'board-header-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const actionsEl = document.createElement('div');
  actionsEl.className = 'board-header-actions';

  if (actions.onOpenAll) {
    const openAllBtn = document.createElement('button');
    openAllBtn.className = 'board-header-btn board-open-all-btn';
    openAllBtn.title = 'Open all links in background tabs (Shift+Click for new window)';
    openAllBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
    openAllBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.onOpenAll(e);
    });
    actionsEl.appendChild(openAllBtn);
  }

  const addBtn = document.createElement('button');
  addBtn.className = 'board-header-btn';
  addBtn.title = 'Add bookmark';
  addBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  addBtn.addEventListener('click', (e) => { e.stopPropagation(); actions.onAdd(); });
  actionsEl.appendChild(addBtn);

  const moreBtn = document.createElement('button');
  moreBtn.className = 'board-header-btn';
  moreBtn.title = 'More options';
  moreBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`;
  moreBtn.addEventListener('click', (e) => { e.stopPropagation(); actions.onMore(e, moreBtn); });
  actionsEl.appendChild(moreBtn);

  header.appendChild(actionsEl);
  return header;
}

// ─────────────────────────────────────────────
// Context Menus
// ─────────────────────────────────────────────
function _showColumnMenu(e, anchorBtn, handlers) {
  _closeAnyOpenMenu();
  const rect = anchorBtn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.top = `${rect.bottom + 6}px`;
  menu.style.left = `${Math.max(8, rect.right - 220)}px`;

  const items = [
    { icon: _iconOpenAll, label: 'Open All Links', fn: handlers.onOpenAll },
    { icon: _iconEdit, label: 'Rename Board', fn: handlers.onRename },
    { icon: _iconPage, label: 'Add Page', fn: handlers.onAddPage },
    { icon: _iconExport, label: 'Export as JSON', fn: handlers.onExportBoard },
    { icon: _iconImport, label: 'Import JSON', fn: handlers.onImportJson },
  ];

  items.forEach(({ icon, label, fn }) => {
    if (!fn) return;
    const btn = document.createElement('button');
    btn.innerHTML = icon + label;
    btn.addEventListener('click', () => { _closeAnyOpenMenu(); fn(); });
    menu.appendChild(btn);
  });

  if (handlers.onSelectAccent) {
    menu.appendChild(document.createElement('hr'));
    const colorWrap = document.createElement('div');
    colorWrap.className = 'context-menu-color-row';
    const colors = [
      { hex: null, label: 'Default' },
      { hex: '#8B5CF6', label: 'Violet' },
      { hex: '#3B82F6', label: 'Blue' },
      { hex: '#10B981', label: 'Emerald' },
      { hex: '#F59E0B', label: 'Amber' },
      { hex: '#EC4899', label: 'Pink' },
      { hex: '#06B6D4', label: 'Cyan' }
    ];
    colors.forEach(({ hex, label }) => {
      const dot = document.createElement('button');
      dot.className = 'context-color-dot' + (handlers.currentAccent === hex ? ' active' : '');
      dot.title = `Card Accent: ${label}`;
      if (hex) {
        dot.style.background = hex;
      } else {
        dot.innerHTML = '✕';
        dot.classList.add('reset-dot');
      }
      dot.addEventListener('click', (ev) => {
        ev.stopPropagation();
        _closeAnyOpenMenu();
        handlers.onSelectAccent(hex);
      });
      colorWrap.appendChild(dot);
    });
    menu.appendChild(colorWrap);
  }

  if (handlers.onDelete) {
    menu.appendChild(document.createElement('hr'));
    const del = document.createElement('button');
    del.className = 'danger';
    del.innerHTML = _iconDelete + (handlers.deleteLabel || 'Delete Board');
    del.addEventListener('click', () => { _closeAnyOpenMenu(); handlers.onDelete(); });
    menu.appendChild(del);
  }

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', _closeAnyOpenMenu, { once: true }), 0);
}

function _showPageTabMenu(e, page, boardId, handlers) {
  _closeAnyOpenMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.top = `${e.clientY}px`;
  menu.style.left = `${e.clientX}px`;

  const openPageBtn = document.createElement('button');
  openPageBtn.innerHTML = _iconOpenAll + 'Open All in Page';
  openPageBtn.addEventListener('click', () => {
    _closeAnyOpenMenu();
    const listEl = document.querySelector(`.bookmark-list[data-page-id="${page.id}"]`);
    if (listEl) _openAllInList(listEl, false);
  });
  menu.appendChild(openPageBtn);

  const rename = document.createElement('button');
  rename.innerHTML = _iconEdit + 'Rename Page';
  rename.addEventListener('click', async () => {
    _closeAnyOpenMenu();
    const newTitle = prompt('Rename page:', page.title);
    if (newTitle && newTitle.trim()) {
      const p = await DB.pages.get(page.id);
      if (p) { p.title = newTitle.trim(); await DB.pages.save(p); handlers.onRefresh(); }
    }
  });
  menu.appendChild(rename);

  const expBtn = document.createElement('button');
  expBtn.innerHTML = _iconExport + 'Export Page JSON';
  expBtn.addEventListener('click', () => { _closeAnyOpenMenu(); exportPage(page.id); });
  menu.appendChild(expBtn);

  menu.appendChild(document.createElement('hr'));
  const del = document.createElement('button');
  del.className = 'danger';
  del.innerHTML = _iconDelete + 'Delete Page';
  del.addEventListener('click', () => {
    _closeAnyOpenMenu();
    if (confirm('Delete this page and all its bookmarks?')) {
      DB.pages.delete(page.id).then(() => handlers.onRefresh());
    }
  });
  menu.appendChild(del);

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', _closeAnyOpenMenu, { once: true }), 0);
}

function _showBookmarkRowMenu(e, { title, url, opts }) {
  _closeAnyOpenMenu();
  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.top = `${e.clientY}px`;
  menu.style.left = `${e.clientX}px`;

  const copyBtn = document.createElement('button');
  copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> Copy Link`;
  copyBtn.addEventListener('click', () => {
    _closeAnyOpenMenu();
    navigator.clipboard.writeText(url);
  });
  menu.appendChild(copyBtn);

  const incogBtn = document.createElement('button');
  incogBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg> Open in Incognito`;
  incogBtn.addEventListener('click', () => {
    _closeAnyOpenMenu();
    chrome.windows.create({ url, incognito: true });
  });
  menu.appendChild(incogBtn);

  menu.appendChild(document.createElement('hr'));

  const delBtn = document.createElement('button');
  delBtn.className = 'danger';
  delBtn.innerHTML = _iconDelete + ' Move to Trash';
  delBtn.addEventListener('click', () => {
    _closeAnyOpenMenu();
    opts.onDelete();
  });
  menu.appendChild(delBtn);

  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', _closeAnyOpenMenu, { once: true }), 0);
}

export function closeAnyOpenMenu() { _closeAnyOpenMenu(); }
function _closeAnyOpenMenu() { document.querySelectorAll('.context-menu').forEach(m => m.remove()); }

function _openAllInList(listEl, inNewWindow = false) {
  const links = [...listEl.querySelectorAll('.bookmark-link-content')];
  if (!links.length) return;
  if (links.length > 8 && !confirm(`Open ${links.length} tabs?`)) return;
  const urls = links.map(a => a.href).filter(Boolean);
  if (inNewWindow) {
    chrome.windows.create({ url: urls });
  } else {
    urls.forEach(url => chrome.tabs.create({ url, active: false }));
  }
}

// ─────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────
function _buildEmptyState(msg) {
  const el = document.createElement('div');
  el.className = 'board-empty-state';
  el.textContent = msg;
  return el;
}

// ─────────────────────────────────────────────
// SVG icon snippets
// ─────────────────────────────────────────────
const _iconOpenAll = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
const _iconEdit = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>`;
const _iconDelete = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
const _iconPage = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
const _iconWallpaper = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
const _iconExport = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
const _iconImport = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

function _esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─────────────────────────────────────────────
// Board Resizing
// ─────────────────────────────────────────────
function _attachResize(column, identifier) {
  const createResizer = (className, type) => {
    const el = document.createElement('div');
    el.className = className;
    column.appendChild(el);
    
    let isResizing = false;
    let startX = 0, startY = 0, startWidth = 0, startHeight = 0;

    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = column.getBoundingClientRect();
      startWidth = rect.width;
      startHeight = rect.height;
      el.setPointerCapture(e.pointerId);
      e.stopPropagation();
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (!isResizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (type === 'width' || type === 'both') {
        column.style.width = `${Math.max(200, Math.min(800, startWidth + dx))}px`;
      }
      if (type === 'height' || type === 'both') {
        column.style.height = `${Math.max(150, Math.min(2000, startHeight + dy))}px`;
      }
      e.stopPropagation();
    });

    const stopResize = async (e) => {
      if (!isResizing) return;
      isResizing = false;
      el.releasePointerCapture(e.pointerId);
      
      const pos = (await loadBoardPositions())[identifier] || {};
      let changed = false;
      const finalWidth = parseInt(column.style.width, 10);
      const finalHeight = parseInt(column.style.height, 10);
      
      if (!isNaN(finalWidth)) { pos.width = finalWidth; changed = true; }
      if (!isNaN(finalHeight)) { pos.height = finalHeight; changed = true; }
      
      if (changed) {
        await saveBoardPosition(identifier, pos);
      }
      e.stopPropagation();
    };

    el.addEventListener('pointerup', stopResize);
    el.addEventListener('pointercancel', stopResize);
  };

  createResizer('board-resize-right', 'width');
  createResizer('board-resize-bottom', 'height');
  createResizer('board-resize-corner', 'both');
}

// ─────────────────────────────────────────────
// Tidy Up / Auto-Align Free Canvas
// ─────────────────────────────────────────────
export async function tidyUpCanvas(workspace) {
  if (!workspace || layoutMode !== 'canvas') return;
  const cols = [...workspace.querySelectorAll('.board-column')];
  if (!cols.length) return;

  // Sort columns roughly by current top-to-bottom, left-to-right visual order
  cols.sort((a, b) => {
    const ay = parseInt(a.style.top || '0', 10);
    const by = parseInt(b.style.top || '0', 10);
    if (Math.abs(ay - by) > 80) return ay - by;
    return parseInt(a.style.left || '0', 10) - parseInt(b.style.left || '0', 10);
  });

  const positions = await loadBoardPositions();
  const PAD_X = 40;
  const PAD_Y = 24;
  const GAP_X = 24;
  const GAP_Y = 24;
  const maxViewportWidth = Math.max(workspace.clientWidth - PAD_X, 960);

  let curX = PAD_X;
  let curY = PAD_Y;
  let rowMaxHeight = 0;
  let zCounter = 101;

  cols.forEach(col => {
    const id = col.dataset.boardId || col.dataset.folderId;
    const rect = col.getBoundingClientRect();
    const w = rect.width || 300;
    const h = rect.height || 260;

    if (curX > PAD_X && curX + w > maxViewportWidth) {
      curX = PAD_X;
      curY += rowMaxHeight + GAP_Y;
      rowMaxHeight = 0;
    }

    const snapX = Math.round(curX / 20) * 20;
    const snapY = Math.round(curY / 20) * 20;

    col.style.transition = 'left 0.35s cubic-bezier(0.2, 0.8, 0.2, 1), top 0.35s cubic-bezier(0.2, 0.8, 0.2, 1)';
    col.style.left = `${snapX}px`;
    col.style.top = `${snapY}px`;
    col.style.zIndex = zCounter;

    setTimeout(() => {
      col.style.transition = '';
    }, 380);

    if (id) {
      positions[id] = {
        ...(positions[id] || {}),
        x: snapX,
        y: snapY,
        zIndex: zCounter
      };
    }

    curX += w + GAP_X;
    if (h > rowMaxHeight) rowMaxHeight = h;
    zCounter++;
  });

  setMaxZIndex(zCounter);
  await DB.settings.set('board_positions', positions);
  workspace.scrollTo({ left: 0, top: 0, behavior: 'smooth' });
}
