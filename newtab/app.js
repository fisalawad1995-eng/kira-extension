// Board Tab — app.js
// Central orchestrator: wires all modules, handles UI events, renders workspace.

import { init as initDB, DB } from '../db/indexeddb.js';
import { buildSearchIndex, search } from '../modules/search.js';
import {
  buildBoardColumn, buildFolderColumn,
  loadBoardPositions, setMaxZIndex, layoutMode, setLayoutMode, loadColumnOrder, getFaviconUrl, createFaviconImg,
  tidyUpCanvas, closeAnyOpenMenu
}
  from '../modules/boards.js';
import {
  applyPersistedTheme, applyMode, applyAccent,
  applyGlobalWallpaper, applyAllBoardWallpapers,
  applyBoardWallpaper, getSavedWallpapers,
  addSavedWallpaper, deleteSavedWallpaper
} from '../modules/theme.js';
import {
  initBlur, toggleBlur, isBlurEnabled,
  getTrashItems, getTrashedBoards, softDeleteBoard,
  restoreBoardFromTrash, permanentlyDeleteBoard,
  restoreFromTrash, permanentlyDelete,
  purgeExpiredTrash
} from '../modules/privacy.js';
import { initQuickSaveListener } from '../modules/quick-save.js';
import { importFromChromeBookmarks, importFromHtmlFile } from '../modules/import.js';
import { importFromJson } from '../modules/export.js';
import {
  initAmbientClock, initWeatherWidget, initScratchpadWidget, initSessionStash,
  initSpotlightAndShortcuts, initCanvasPan
} from '../modules/widgets.js';

// ─────────────────────────────────────────────
// DOM references
// ─────────────────────────────────────────────
const workspace = document.getElementById('workspace-container');
const searchInput = document.getElementById('search-input');
const googleSearchInput = document.getElementById('google-search-input');
const googleSearchSuggestions = document.getElementById('google-search-suggestions');
const searchResults = document.getElementById('search-results-panel');
const btnHome = document.getElementById('btn-home');
const btnAddBoard = document.getElementById('btn-add-board');
const btnImport = document.getElementById('btn-import');
const btnTrash = document.getElementById('btn-trash');
const btnBlurToggle = document.getElementById('btn-blur-toggle');
const btnOpenSettings = document.getElementById('btn-open-settings');
const settingsPanel = document.getElementById('settings-panel');
const trashPanel = document.getElementById('trash-panel');
const trashItemsList = document.getElementById('trash-items-list');
const btnTrashClose = document.getElementById('btn-trash-close');
const addLinkModal = document.getElementById('add-link-modal');
const addLinkInput = document.getElementById('new-link-url');
const addLinkTitleInput = document.getElementById('new-link-title');
const addLinkPageSelect = document.getElementById('new-link-page-select');
const addLinkPageRow = document.getElementById('add-link-page-row');
const btnConfirmAdd = document.getElementById('btn-confirm-add');
const btnCancelAdd = document.getElementById('btn-cancel-add');
const importModal = document.getElementById('import-modal');
const importChoiceBtns = document.getElementById('import-choice-buttons');
const btnImportChrome = document.getElementById('btn-import-chrome');
const btnImportHtml = document.getElementById('btn-import-html');
const btnCancelImport = document.getElementById('btn-cancel-import');
const importProgressSec = document.getElementById('import-progress-section');
const importProgressFill = document.getElementById('import-progress-fill');
const importStatusText = document.getElementById('import-status-text');
const importConflictSec = document.getElementById('import-conflict-section');
const importConflictList = document.getElementById('import-conflict-list');
const importDoneRow = document.getElementById('import-done-row');
const btnImportDone = document.getElementById('btn-import-done');
const bgFileInput = document.getElementById('bg-file-input');
const importHtmlInput = document.getElementById('import-html-input');
const importJsonInput = document.getElementById('import-json-input');
const btnUploadBg = document.getElementById('btn-upload-bg');
const accentSwatches = document.getElementById('accent-swatches');
const accentCustomInput = document.getElementById('accent-custom-input');
const blurCheckbox = document.getElementById('blur-toggle-checkbox');
const styleToggles = document.querySelectorAll('.style-toggle');

const btnLayoutSettings = document.getElementById('btn-layout-settings');
const layoutSettingsMenu = document.getElementById('layout-settings-menu');
const layoutModeRadios = document.querySelectorAll('input[name="layout-mode"]');

// Add Board Modal
const addBoardModal = document.getElementById('add-board-modal');
const newBoardTitleInput = document.getElementById('new-board-title');
const btnConfirmAddBoard = document.getElementById('btn-confirm-add-board');
const btnCancelAddBoard = document.getElementById('btn-cancel-add-board');

// Add Page Modal
const addPageModal = document.getElementById('add-page-modal');
const newPageTitleInput = document.getElementById('new-page-title');
const btnConfirmAddPage = document.getElementById('btn-confirm-add-page');
const btnCancelAddPage = document.getElementById('btn-cancel-add-page');

// Rename Modal
const renameModal = document.getElementById('rename-modal');
const renameModalHeading = document.getElementById('rename-modal-heading');
const renameTitleInput = document.getElementById('rename-title-input');
const btnConfirmRename = document.getElementById('btn-confirm-rename');
const btnCancelRename = document.getElementById('btn-cancel-rename');

// Onboarding Modal
const onboardingModal = document.getElementById('onboarding-modal');
const btnCloseOnboarding = document.getElementById('btn-close-onboarding');

let currentAddTarget = null; // { type, boardId?, folderId?, pageId? }
let searchDebounce = null;
let activeBoardId = null;   // tracks the board column last interacted with

// ─────────────────────────────────────────────
// BOOT
// ─────────────────────────────────────────────
(async () => {
  await initDB();
  await applyPersistedTheme();
  await initBlur();
  blurCheckbox.checked = isBlurEnabled();

  initQuickSaveListener();
  await purgeExpiredTrash();

  const savedLayout = (await DB.settings.get('layout_mode')) || 'canvas';
  setLayoutMode(savedLayout);
  workspace.classList.add(`layout-${layoutMode}`);
  layoutModeRadios.forEach(r => {
    if (r.value === layoutMode) r.checked = true;
  });

  // Layout setting events
  btnLayoutSettings.addEventListener('click', () => layoutSettingsMenu.classList.toggle('hidden'));
  document.addEventListener('click', (e) => {
    if (!btnLayoutSettings.contains(e.target) && !layoutSettingsMenu.contains(e.target)) {
      layoutSettingsMenu.classList.add('hidden');
    }
  });
  const btnTidyCanvas = document.getElementById('btn-tidy-canvas');
  const updateTidyBtnVisibility = () => {
    if (btnTidyCanvas) btnTidyCanvas.classList.toggle('hidden', layoutMode !== 'canvas');
  };
  updateTidyBtnVisibility();

  if (btnTidyCanvas) {
    btnTidyCanvas.addEventListener('click', async () => {
      layoutSettingsMenu.classList.add('hidden');
      await tidyUpCanvas(workspace);
    });
  }

  layoutModeRadios.forEach(r => {
    r.addEventListener('change', async (e) => {
      setLayoutMode(e.target.value);
      workspace.classList.remove('layout-canvas', 'layout-grid');
      workspace.classList.add(`layout-${layoutMode}`);
      updateTidyBtnVisibility();
      await DB.settings.set('layout_mode', layoutMode);
      renderAll();
    });
  });

  await renderAll();
  await renderWallpaperGallery();
  _refreshSearchIndex();

  // Initialize Productivity & Ambient Widgets + Session Stash + Spotlight + Canvas Pan
  initAmbientClock();
  initWeatherWidget();
  initScratchpadWidget();
  initSessionStash(renderAll);
  initCanvasPan(workspace);
  initSpotlightAndShortcuts({
    onTidyUp: async () => {
      if (layoutMode !== 'canvas') {
        setLayoutMode('canvas');
        workspace.classList.remove('layout-canvas', 'layout-grid');
        workspace.classList.add('layout-canvas');
        layoutModeRadios.forEach(r => { r.checked = (r.value === 'canvas'); });
        updateTidyBtnVisibility();
        await DB.settings.set('layout_mode', 'canvas');
        await renderAll();
      }
      await tidyUpCanvas(workspace);
    },
    onNewBoard: () => btnAddBoard.click(),
    onStashTabs: () => document.getElementById('btn-stash-tabs')?.click(),
    onToggleNotes: () => document.getElementById('btn-notes-toggle')?.click(),
    onToggleBlur: () => btnBlurToggle.click(),
    onToggleLayout: async () => {
      const next = layoutMode === 'canvas' ? 'grid' : 'canvas';
      setLayoutMode(next);
      workspace.classList.remove('layout-canvas', 'layout-grid');
      workspace.classList.add(`layout-${next}`);
      layoutModeRadios.forEach(r => { r.checked = (r.value === next); });
      updateTidyBtnVisibility();
      await DB.settings.set('layout_mode', next);
      await renderAll();
    },
    onToggleTheme: () => {
      const curMode = document.body.dataset.theme === 'light' ? 'dark' : 'light';
      styleToggles.forEach(b => b.classList.toggle('active', b.dataset.mode === curMode));
      applyMode(curMode);
    },
    onOpenImport: () => btnImport.click(),
    onOpenTrash: () => btnTrash.click(),
    onEscapeAll: () => {
      document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
      settingsPanel.classList.add('hidden');
      trashPanel.classList.add('hidden');
      layoutSettingsMenu.classList.add('hidden');
      closeAnyOpenMenu();
    }
  });

  // Listen for quick-save refresh
  window.addEventListener('boardtab:refresh', renderAll);

  // Onboarding
  if (btnCloseOnboarding) {
    btnCloseOnboarding.addEventListener('click', async () => {
      onboardingModal.classList.add('hidden');
      await DB.settings.set('has_seen_onboarding', true);
    });
  }
  const hasSeenOnboarding = await DB.settings.get('has_seen_onboarding');
  if (!hasSeenOnboarding && onboardingModal) {
    onboardingModal.classList.remove('hidden');
  }
})();

// ─────────────────────────────────────────────
// RENDER
// ─────────────────────────────────────────────
async function renderAll() {
  const scrollLeft = workspace.scrollLeft;
  workspace.innerHTML = '';

  const [boards, boardPositions, columnOrder, folderAccents] = await Promise.all([
    DB.boards.getAll(),
    loadBoardPositions(),
    loadColumnOrder(),
    DB.settings.get('folder_accents').then(res => res || {})
  ]);

  // Native bookmark folders
  const nativeFolders = await _getNativeFolders();

  if (!boards.length && !nativeFolders.length) {
    workspace.innerHTML = `
      <div class="empty-hint">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4">
          <rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>
        </svg>
        No boards yet — click <strong>+ Board</strong> to get started.
      </div>`;
    return;
  }

  // Gather all columns with their IDs for sorting
  const allColumns = [];

  for (const folder of nativeFolders) {
    const items = (folder.children || []).filter(c => c.url);
    const el = buildFolderColumn(folder.title, folder.id, items, {
      onAdd: () => openAddLinkModal({ type: 'folder', folderId: folder.id }),
      onOpenAll: (inNewWindow) => _openAllInItems(items, inNewWindow),
      onRename: () => _renameFolder(folder.id, folder.title),
      onDelete: () => _deleteFolder(folder.id, folder.title),
      onRefresh: renderAll,
      onReorder: renderAll,
      accentColor: folderAccents[folder.id] || null,
      onSelectAccent: async (hex) => {
        const current = (await DB.settings.get('folder_accents')) || {};
        if (hex) current[folder.id] = hex;
        else delete current[folder.id];
        await DB.settings.set('folder_accents', current);
      }
    });
    allColumns.push({ id: folder.id, el });
  }

  for (const board of boards) {
    const pages = await DB.pages.getForBoard(board.id);
    const bookmarksByPage = {};
    for (const page of pages) {
      bookmarksByPage[page.id] = await DB.bookmarks.getForPage(page.id);
    }
    const el = buildBoardColumn(board, pages, bookmarksByPage, {
      onAddBookmark: (bId) => openAddLinkModal({ type: 'custom', boardId: bId }),
      onRenameBoard: _renameBoard,
      onDeleteBoard: _deleteBoard,
      onAddPage: _addPage,
      onImportJson: () => importJsonInput.click(),
      onRefresh: renderAll,
      onReorder: renderAll
    });
    allColumns.push({ id: board.id, el });
  }
  if (layoutMode === 'grid') {
    allColumns.sort((a, b) => {
      let ia = columnOrder.indexOf(a.id);
      let ib = columnOrder.indexOf(b.id);
      if (ia === -1) ia = 9999;
      if (ib === -1) ib = 9999;
      return ia - ib;
    });
  }

  // Apply positions or clear them based on mode
  if (layoutMode === 'canvas') {
    let maxZ = 100;
    let unpositionedCount = 0;
    allColumns.forEach(col => {
      const pos = boardPositions[col.id];
      if (pos) {
        col.el.style.left = `${pos.x}px`;
        col.el.style.top = `${pos.y}px`;
        col.el.style.zIndex = pos.zIndex || 100;
        if (pos.width) col.el.style.width = `${pos.width}px`;
        if (pos.height) col.el.style.height = `${pos.height}px`;
        if (pos.zIndex > maxZ) maxZ = pos.zIndex;
      } else {
        col.el.style.left = `${40 + unpositionedCount * 40}px`;
        col.el.style.top = `${40 + unpositionedCount * 40}px`;
        col.el.style.zIndex = 100 + unpositionedCount;
        if (col.el.style.zIndex > maxZ) maxZ = parseInt(col.el.style.zIndex, 10);
        unpositionedCount++;
      }
      workspace.appendChild(col.el);
    });
    setMaxZIndex(maxZ);
  } else {
    allColumns.forEach(col => {
      const pos = boardPositions[col.id];
      if (pos && pos.width) col.el.style.width = `${pos.width}px`;
      else col.el.style.width = '';
      if (pos && pos.height) col.el.style.height = `${pos.height}px`;
      else col.el.style.height = '';
      col.el.style.left = '';
      col.el.style.top = '';
      col.el.style.zIndex = '';
      col.el.style.position = '';
      workspace.appendChild(col.el);
    });
  }

  workspace.scrollLeft = scrollLeft;
  _refreshSearchIndex();
}

// ─────────────────────────────────────────────
// NATIVE BOOKMARK FOLDERS
// ─────────────────────────────────────────────
async function _getNativeFolders() {
  const [hiddenFolders, showEmpty] = await Promise.all([
    DB.settings.get('hidden_folders').then(res => res || []),
    DB.settings.get('show_empty_folders').then(res => res || false)
  ]);

  return new Promise(resolve => {
    chrome.bookmarks.getTree(tree => {
      if (!tree || !tree[0]) { resolve([]); return; }
      const rootFolders = tree[0].children || [];
      const filtered = rootFolders.filter(f => {
        if (!f.children) return false;
        if (hiddenFolders.includes(f.id)) return false;
        const hasBookmarks = f.children.some(c => c.url);
        if (!hasBookmarks && !showEmpty) return false;
        return true;
      });
      resolve(filtered);
    });
  });
}

// ─────────────────────────────────────────────
// BOARD / PAGE MODAL ACTIONS
// ─────────────────────────────────────────────
let pendingAddPageBoardId = null;
let pendingRenameCallback = null;

btnAddBoard.addEventListener('click', () => {
  newBoardTitleInput.value = '';
  addBoardModal.classList.remove('hidden');
  setTimeout(() => newBoardTitleInput.focus(), 50);
});

btnCancelAddBoard.addEventListener('click', () => addBoardModal.classList.add('hidden'));

async function handleCreateBoard() {
  const title = newBoardTitleInput.value.trim();
  if (!title) return;
  addBoardModal.classList.add('hidden');
  const board = await DB.boards.create(title);
  await DB.pages.create(board.id, 'General');
  await renderAll();
}

btnConfirmAddBoard.addEventListener('click', handleCreateBoard);
newBoardTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCreateBoard();
  if (e.key === 'Escape') addBoardModal.classList.add('hidden');
});

function _addPage(boardId) {
  pendingAddPageBoardId = boardId;
  newPageTitleInput.value = '';
  addPageModal.classList.remove('hidden');
  setTimeout(() => newPageTitleInput.focus(), 50);
}

btnCancelAddPage.addEventListener('click', () => addPageModal.classList.add('hidden'));

async function handleCreatePage() {
  const title = newPageTitleInput.value.trim();
  if (!title || !pendingAddPageBoardId) return;
  addPageModal.classList.add('hidden');
  await DB.pages.create(pendingAddPageBoardId, title);
  pendingAddPageBoardId = null;
  await renderAll();
}

btnConfirmAddPage.addEventListener('click', handleCreatePage);
newPageTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleCreatePage();
  if (e.key === 'Escape') addPageModal.classList.add('hidden');
});

function openRenameModal(headingText, currentTitle, onSave) {
  renameModalHeading.textContent = headingText;
  renameTitleInput.value = currentTitle || '';
  pendingRenameCallback = onSave;
  renameModal.classList.remove('hidden');
  setTimeout(() => {
    renameTitleInput.focus();
    renameTitleInput.select();
  }, 50);
}

btnCancelRename.addEventListener('click', () => renameModal.classList.add('hidden'));

async function handleConfirmRename() {
  const newTitle = renameTitleInput.value.trim();
  if (!newTitle || !pendingRenameCallback) return;
  renameModal.classList.add('hidden');
  const cb = pendingRenameCallback;
  pendingRenameCallback = null;
  await cb(newTitle);
}

btnConfirmRename.addEventListener('click', handleConfirmRename);
renameTitleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') handleConfirmRename();
  if (e.key === 'Escape') renameModal.classList.add('hidden');
});

async function _renameBoard(boardId, currentTitle) {
  openRenameModal('Rename Board', currentTitle, async (newTitle) => {
    const board = await DB.boards.get(boardId);
    if (board) { board.title = newTitle; await DB.boards.save(board); renderAll(); }
  });
}

function _renameFolder(folderId, currentTitle) {
  openRenameModal('Rename Folder', currentTitle, async (newTitle) => {
    chrome.bookmarks.update(folderId, { title: newTitle }, renderAll);
  });
}

async function _deleteBoard(boardId) {
  if (!confirm('Move this board and all its pages to Trash?')) return;
  await softDeleteBoard(boardId);
  renderAll();
}

function _deleteFolder(folderId, title) {
  if (!confirm(`Delete folder "${title}" and all its bookmarks?`)) return;
  chrome.bookmarks.removeTree(folderId, async () => {
    if (chrome.runtime.lastError) {
      // If Chrome system root folder that cannot be removed via API, hide it
      const hidden = (await DB.settings.get('hidden_folders')) || [];
      if (!hidden.includes(folderId)) {
        hidden.push(folderId);
        await DB.settings.set('hidden_folders', hidden);
      }
      chrome.bookmarks.getChildren(folderId, (children) => {
        if (children) children.forEach(c => chrome.bookmarks.removeTree(c.id));
        renderAll();
      });
    } else {
      renderAll();
    }
  });
}

function _openAllInItems(items, inNewWindow = false) {
  if (!items || !items.length) return;
  if (items.length > 8 && !confirm(`Open ${items.length} tabs?`)) return;
  const urls = items.map(i => i.url).filter(Boolean);
  if (inNewWindow) {
    chrome.windows.create({ url: urls });
  } else {
    urls.forEach(url => chrome.tabs.create({ url, active: false }));
  }
}

// ─────────────────────────────────────────────
// ADD LINK MODAL
// ─────────────────────────────────────────────
async function openAddLinkModal(target) {
  currentAddTarget = target;
  addLinkInput.value = '';
  addLinkTitleInput.value = '';
  addLinkPageSelect.innerHTML = '';

  if (target.type === 'custom') {
    addLinkPageRow.classList.remove('hidden');
    const pages = await DB.pages.getForBoard(target.boardId);
    pages.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.title;
      addLinkPageSelect.appendChild(opt);
    });
    // Pre-select the active page if we know it
    if (target.pageId) addLinkPageSelect.value = target.pageId;
  } else {
    addLinkPageRow.classList.add('hidden');
  }

  addLinkModal.classList.remove('hidden');
  addLinkInput.focus();
}

btnCancelAdd.addEventListener('click', () => {
  addLinkModal.classList.add('hidden');
  currentAddTarget = null;
});

addLinkModal.addEventListener('click', e => {
  if (e.target === addLinkModal) { addLinkModal.classList.add('hidden'); currentAddTarget = null; }
});

btnConfirmAdd.addEventListener('click', async () => {
  const rawUrl = addLinkInput.value.trim();
  if (!rawUrl || !currentAddTarget) return;
  const url = /^https?:\/\//i.test(rawUrl) ? rawUrl : 'https://' + rawUrl;
  let title = addLinkTitleInput.value.trim();
  if (!title) {
    try { title = new URL(url).hostname; } catch { title = url; }
  }

  if (currentAddTarget.type === 'folder') {
    chrome.bookmarks.create({ parentId: currentAddTarget.folderId, title, url }, renderAll);
  } else {
    const pageId = addLinkPageSelect.value || currentAddTarget.pageId;
    if (!pageId) return;
    await DB.bookmarks.create(pageId, { url, title, favicon: getFaviconUrl(url) });
    renderAll();
  }
  addLinkModal.classList.add('hidden');
  currentAddTarget = null;
});

// Enter key submits
addLinkInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnConfirmAdd.click(); });

// ─────────────────────────────────────────────
// SMART SEARCH
// ─────────────────────────────────────────────
async function _refreshSearchIndex() {
  const customBookmarks = await DB.bookmarks.getAllActive();
  const nativeFolders = await _getNativeFolders();
  const { pageMap, boardMap } = await _buildMaps();

  const formattedCustom = customBookmarks.map(bk => ({
    id: bk.id,
    page_id: bk.page_id,
    board_id: pageMap[bk.page_id]?.board_id ?? '',
    title: bk.title,
    url: bk.url,
    favicon: bk.favicon || '',
    board_title: boardMap[pageMap[bk.page_id]?.board_id]?.title || 'Board',
    page_title: pageMap[bk.page_id]?.title || 'Page',
    tags: bk.tags || []
  }));

  const formattedNative = [];
  function recurseNative(folders, parentTitle) {
    for (const folder of folders) {
      const folderTitle = folder.title || parentTitle || 'Bookmarks';
      (folder.children || []).forEach(child => {
        if (child.url) {
          formattedNative.push({
            id: child.id,
            page_id: folder.id,
            board_id: folder.id,
            title: child.title || child.url,
            url: child.url,
            favicon: '',
            board_title: folderTitle,
            page_title: 'Folder',
            tags: []
          });
        } else if (child.children) {
          recurseNative([child], folderTitle);
        }
      });
    }
  }
  recurseNative(nativeFolders, '');

  buildSearchIndex([...formattedCustom, ...formattedNative]);
}

async function _buildMaps() {
  const boards = await DB.boards.getAll();
  const boardMap = {};
  boards.forEach(b => { boardMap[b.id] = { title: b.title }; });

  const pageMap = {};
  for (const board of boards) {
    const pages = await DB.pages.getForBoard(board.id);
    pages.forEach(p => { pageMap[p.id] = { title: p.title, board_id: board.id }; });
  }
  return { pageMap, boardMap };
}

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(_runSearch, 150);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { searchInput.value = ''; _hideSearchResults(); }
});

function _runSearch() {
  const q = searchInput.value.trim();
  if (!q) { _hideSearchResults(); return; }
  const results = search(q);
  _renderSearchResults(results);
}

function _renderSearchResults(results) {
  searchResults.innerHTML = '';
  if (!results.length) {
    searchResults.innerHTML = '<div class="search-no-results">No results found</div>';
  } else {
    results.slice(0, 50).forEach(r => {
      const item = document.createElement('a');
      item.className = 'search-result-item';
      item.href = r.url;
      item.target = '_blank';
      const img = createFaviconImg(r.url, 'search-result-favicon');
      const info = document.createElement('div');
      info.className = 'search-result-info';
      info.innerHTML = `
        <div class="search-result-title">${_esc(r.title)}</div>
        <div class="search-result-breadcrumb">${_esc(r.board_title)} › ${_esc(r.page_title)}</div>
      `;
      const urlDiv = document.createElement('div');
      urlDiv.className = 'search-result-url';
      urlDiv.textContent = r.url;

      item.appendChild(img);
      item.appendChild(info);
      item.appendChild(urlDiv);
      searchResults.appendChild(item);
    });
  }
  searchResults.classList.remove('hidden');
}

function _hideSearchResults() {
  searchResults.classList.add('hidden');
  searchResults.innerHTML = '';
}

// Close search results on outside click
document.addEventListener('click', e => {
  if (!searchResults.contains(e.target) && e.target !== searchInput) _hideSearchResults();
});

// Google Search Logic
let googleSearchDebounce = null;
let currentSuggestionIndex = -1;

if (googleSearchInput && googleSearchSuggestions) {
  googleSearchInput.addEventListener('input', () => {
    clearTimeout(googleSearchDebounce);
    googleSearchDebounce = setTimeout(async () => {
      const q = googleSearchInput.value.trim();
      if (!q) {
        _hideGoogleSuggestions();
        return;
      }
      try {
        const res = await fetch(`https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const data = await res.json();
          const suggestions = data[1] || [];
          _renderGoogleSuggestions(suggestions, q);
        }
      } catch (err) {
        console.error('Failed to fetch suggestions', err);
      }
    }, 150);
  });

  googleSearchInput.addEventListener('keydown', e => {
    const items = googleSearchSuggestions.querySelectorAll('.google-suggestion-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        currentSuggestionIndex = (currentSuggestionIndex + 1) % items.length;
        _updateGoogleSuggestionSelection(items);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        currentSuggestionIndex = (currentSuggestionIndex - 1 + items.length) % items.length;
        _updateGoogleSuggestionSelection(items);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      let query = googleSearchInput.value.trim();
      if (currentSuggestionIndex >= 0 && currentSuggestionIndex < items.length) {
        query = items[currentSuggestionIndex].dataset.suggestion;
      }
      if (query) {
        window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
      }
    } else if (e.key === 'Escape') {
      _hideGoogleSuggestions();
    }
  });

  document.addEventListener('click', e => {
    if (!googleSearchSuggestions.contains(e.target) && e.target !== googleSearchInput) {
      _hideGoogleSuggestions();
    }
  });
}

function _updateGoogleSuggestionSelection(items) {
  items.forEach((item, idx) => {
    if (idx === currentSuggestionIndex) {
      item.classList.add('selected');
      googleSearchInput.value = item.dataset.suggestion;
    } else {
      item.classList.remove('selected');
    }
  });
}

function _renderGoogleSuggestions(suggestions, query) {
  googleSearchSuggestions.innerHTML = '';
  currentSuggestionIndex = -1;
  if (!suggestions.length) {
    _hideGoogleSuggestions();
    return;
  }
  suggestions.slice(0, 8).forEach(s => {
    const item = document.createElement('div');
    item.className = 'google-suggestion-item';
    item.dataset.suggestion = s;

    const icon = document.createElement('div');
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="opacity: 0.5; margin-right: 8px;"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>`;
    icon.style.display = 'flex';

    const textSpan = document.createElement('span');
    textSpan.className = 'search-result-title';
    textSpan.textContent = s;

    item.appendChild(icon);
    item.appendChild(textSpan);

    item.addEventListener('click', () => {
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(s)}`;
    });
    googleSearchSuggestions.appendChild(item);
  });
  googleSearchSuggestions.classList.remove('hidden');
}

function _hideGoogleSuggestions() {
  googleSearchSuggestions.classList.add('hidden');
  googleSearchSuggestions.innerHTML = '';
  currentSuggestionIndex = -1;
}

// ─────────────────────────────────────────────
// TOP BAR ACTIONS (Zen Mode on Home button)
// ─────────────────────────────────────────────
btnHome.addEventListener('click', (e) => {
  e.stopPropagation();
  const isZen = document.body.classList.toggle('zen-mode');
  if (!isZen) {
    workspace.scrollTo({ left: 0, behavior: 'smooth' });
  }
});

// Exit Zen Mode when clicking anywhere or pressing Escape
document.addEventListener('click', (e) => {
  if (document.body.classList.contains('zen-mode')) {
    document.body.classList.remove('zen-mode');
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && document.body.classList.contains('zen-mode')) {
    document.body.classList.remove('zen-mode');
  }
});

// ─────────────────────────────────────────────
// BLUR & FOLDER TOGGLES
// ─────────────────────────────────────────────
btnBlurToggle.addEventListener('click', async () => {
  const enabled = await toggleBlur();
  blurCheckbox.checked = enabled;
  btnBlurToggle.style.color = enabled ? 'var(--color-accent)' : '';
});

blurCheckbox.addEventListener('change', async () => {
  if (blurCheckbox.checked !== isBlurEnabled()) {
    await toggleBlur();
    btnBlurToggle.style.color = isBlurEnabled() ? 'var(--color-accent)' : '';
  }
});

const showEmptyFoldersCheckbox = document.getElementById('show-empty-folders-checkbox');
const btnResetHiddenFolders = document.getElementById('btn-reset-hidden-folders');

if (showEmptyFoldersCheckbox) {
  DB.settings.get('show_empty_folders').then(val => {
    showEmptyFoldersCheckbox.checked = !!val;
  });
  showEmptyFoldersCheckbox.addEventListener('change', async () => {
    await DB.settings.set('show_empty_folders', showEmptyFoldersCheckbox.checked);
    renderAll();
  });
}

if (btnResetHiddenFolders) {
  btnResetHiddenFolders.addEventListener('click', async () => {
    await DB.settings.set('hidden_folders', []);
    alert('Restored all hidden Chrome folders!');
    renderAll();
  });
}

// ─────────────────────────────────────────────
// TRASH PANEL
// ─────────────────────────────────────────────
btnTrash.addEventListener('click', async () => {
  trashPanel.classList.remove('hidden');
  settingsPanel.classList.add('hidden');
  await renderTrashPanel();
});

btnTrashClose.addEventListener('click', () => trashPanel.classList.add('hidden'));

async function renderTrashPanel() {
  trashItemsList.innerHTML = '';
  const [trashedBoards, items] = await Promise.all([
    getTrashedBoards(),
    getTrashItems()
  ]);

  if (!trashedBoards.length && !items.length) {
    trashItemsList.innerHTML = '<div class="trash-empty">Trash is empty</div>';
    return;
  }

  // Section 1: Trashed Boards
  if (trashedBoards.length) {
    const boardHeader = document.createElement('div');
    boardHeader.style.cssText = 'font-size:12px;font-weight:700;color:var(--text-secondary);margin:8px 0 6px;padding-left:4px;letter-spacing:0.05em;';
    boardHeader.textContent = 'TRASHED BOARDS';
    trashItemsList.appendChild(boardHeader);

    trashedBoards.forEach(b => {
      const el = document.createElement('div');
      el.className = 'trash-item';
      el.innerHTML = `
        <div style="font-size:16px;margin-right:4px;">📋</div>
        <div class="trash-item-info">
          <div class="trash-item-title">${_esc(b.title)}</div>
          <div class="trash-item-url" style="color:var(--color-accent);">Board</div>
        </div>
        <div class="trash-item-actions">
          <button class="btn-trash-restore-board btn-trash-restore" data-id="${b.id}">Restore</button>
          <button class="btn-trash-delete-board btn-trash-delete" data-id="${b.id}">Delete</button>
        </div>
      `;
      trashItemsList.appendChild(el);
    });
  }

  // Section 2: Trashed Bookmarks
  if (items.length) {
    const bkHeader = document.createElement('div');
    bkHeader.style.cssText = 'font-size:12px;font-weight:700;color:var(--text-secondary);margin:16px 0 6px;padding-left:4px;letter-spacing:0.05em;';
    bkHeader.textContent = 'TRASHED BOOKMARKS';
    trashItemsList.appendChild(bkHeader);

    items.forEach(bk => {
      const el = document.createElement('div');
      el.className = 'trash-item';
      const img = createFaviconImg(bk.url, 'favicon-img');
      const info = document.createElement('div');
      info.className = 'trash-item-info';
      info.innerHTML = `
        <div class="trash-item-title">${_esc(bk.title)}</div>
        <div class="trash-item-url">${_esc(bk.url)}</div>
      `;
      const actions = document.createElement('div');
      actions.className = 'trash-item-actions';
      actions.innerHTML = `
        <button class="btn-trash-restore-bk btn-trash-restore" data-id="${bk.id}">Restore</button>
        <button class="btn-trash-delete-bk btn-trash-delete" data-id="${bk.id}">Delete</button>
      `;

      el.appendChild(img);
      el.appendChild(info);
      el.appendChild(actions);
      trashItemsList.appendChild(el);
    });
  }

  // Wire board trash buttons
  trashItemsList.querySelectorAll('.btn-trash-restore-board').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await restoreBoardFromTrash(btn.dataset.id);
      await renderTrashPanel();
      renderAll();
    });
  });

  trashItemsList.querySelectorAll('.btn-trash-delete-board').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Permanently delete this board and all its pages?')) {
        await permanentlyDeleteBoard(btn.dataset.id);
        await renderTrashPanel();
        renderAll();
      }
    });
  });

  // Wire bookmark trash buttons
  trashItemsList.querySelectorAll('.btn-trash-restore-bk').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await restoreFromTrash(btn.dataset.id);
      await renderTrashPanel();
      renderAll();
    });
  });

  trashItemsList.querySelectorAll('.btn-trash-delete-bk').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm('Permanently delete this bookmark?')) {
        await permanentlyDelete(btn.dataset.id);
        await renderTrashPanel();
      }
    });
  });
}

// ─────────────────────────────────────────────
// IMPORT
// ─────────────────────────────────────────────
btnImport.addEventListener('click', () => {
  importModal.classList.remove('hidden');
  importChoiceBtns.classList.remove('hidden');
  importProgressSec.classList.add('hidden');
  importConflictSec.classList.add('hidden');
  importDoneRow.classList.add('hidden');
});

btnCancelImport.addEventListener('click', () => importModal.classList.add('hidden'));
importModal.addEventListener('click', e => { if (e.target === importModal) importModal.classList.add('hidden'); });

btnImportChrome.addEventListener('click', async () => {
  importChoiceBtns.classList.add('hidden');
  importProgressSec.classList.remove('hidden');
  await _runImport(() => importFromChromeBookmarks(_onImportProgress));
});

const btnImportJsonModal = document.getElementById('btn-import-json-modal');
if (btnImportJsonModal) {
  btnImportJsonModal.addEventListener('click', () => {
    importModal.classList.add('hidden');
    importJsonInput.click();
  });
}

btnImportHtml.addEventListener('click', () => importHtmlInput.click());
importHtmlInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  importModal.classList.remove('hidden');
  importChoiceBtns.classList.add('hidden');
  importProgressSec.classList.remove('hidden');
  await _runImport(() => importFromHtmlFile(file, _onImportProgress));
  importHtmlInput.value = '';
});

async function _runImport(importFn) {
  importProgressFill.style.width = '0%';
  importStatusText.textContent = 'Importing…';
  const result = await importFn();
  importStatusText.textContent = `Done! ${result.bookmarksImported} imported, ${result.duplicatesSkipped} duplicates skipped.`;
  importProgressFill.style.width = '100%';

  if (result.conflicts && result.conflicts.length) {
    importConflictSec.classList.remove('hidden');
    importConflictList.innerHTML = result.conflicts
      .map(c => `<div class="import-conflict-item">↩ ${_esc(c.title)} — ${_esc(c.url)}</div>`)
      .join('');
  }
  importDoneRow.classList.remove('hidden');
  await renderAll();
}

function _onImportProgress({ done, total }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  importProgressFill.style.width = pct + '%';
  importStatusText.textContent = `${done} / ${total} bookmarks processed…`;
}

btnImportDone.addEventListener('click', () => importModal.classList.add('hidden'));

// JSON import (triggered from board context menu)
importJsonInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const result = await importFromJson(text);
    alert(`Imported successfully!\nPages: ${result.pagesImported}\nBookmarks: ${result.bookmarksImported}\nSkipped: ${result.duplicatesSkipped}`);
    renderAll();
  } catch (err) {
    alert('Import failed: ' + err.message);
  }
  importJsonInput.value = '';
});

// ─────────────────────────────────────────────
// SETTINGS SIDEBAR
// ─────────────────────────────────────────────
btnOpenSettings.addEventListener('click', (e) => {
  e.stopPropagation();
  settingsPanel.classList.toggle('hidden');
  trashPanel.classList.add('hidden');
});

document.addEventListener('click', (e) => {
  if (!settingsPanel.contains(e.target) && !btnOpenSettings.contains(e.target)) {
    settingsPanel.classList.add('hidden');
  }
  if (!trashPanel.contains(e.target) && !btnTrash.contains(e.target)) {
    trashPanel.classList.add('hidden');
  }
});

// Light / dark toggle
styleToggles.forEach(btn => {
  btn.addEventListener('click', () => {
    styleToggles.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyMode(btn.dataset.mode);
  });
});

// Accent swatches
accentSwatches.querySelectorAll('.accent-swatch').forEach(swatch => {
  swatch.addEventListener('click', () => {
    accentSwatches.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('active'));
    swatch.classList.add('active');
    applyAccent(swatch.dataset.hex);
    accentCustomInput.value = swatch.dataset.hex;
  });
});

accentCustomInput.addEventListener('input', () => {
  accentSwatches.querySelectorAll('.accent-swatch').forEach(s => s.classList.remove('active'));
  applyAccent(accentCustomInput.value);
});

const wallpaperListEl = document.getElementById('wallpaper-list');
const wallpaperBadgeEl = document.getElementById('wallpaper-count-badge');
const wallpapersHeaderEl = document.getElementById('wallpapers-accordion-header');
const wallpapersChevronEl = document.getElementById('wallpapers-chevron');

if (wallpapersHeaderEl) {
  wallpapersHeaderEl.addEventListener('click', async () => {
    if (!wallpaperListEl) return;
    const isHidden = wallpaperListEl.classList.toggle('hidden');
    if (wallpapersChevronEl) wallpapersChevronEl.classList.toggle('flipped', isHidden);
    await DB.settings.set('wallpapers_collapsed', isHidden);
  });
}

async function renderWallpaperGallery() {
  if (!wallpaperListEl) return;
  const isCollapsed = (await DB.settings.get('wallpapers_collapsed')) || false;
  wallpaperListEl.classList.toggle('hidden', isCollapsed);
  if (wallpapersChevronEl) wallpapersChevronEl.classList.toggle('flipped', isCollapsed);

  wallpaperListEl.innerHTML = '';
  const saved = await getSavedWallpapers();
  if (wallpaperBadgeEl) wallpaperBadgeEl.textContent = saved.length;

  if (!saved.length) {
    wallpaperListEl.innerHTML = '<div style="font-size:12px;color:var(--text-secondary);padding:10px 0;">No downloaded wallpapers yet. Upload one below!</div>';
    return;
  }

  saved.forEach(wp => {
    const card = document.createElement('div');
    card.className = 'wallpaper-card';
    card.innerHTML = `
      <div class="wallpaper-img-preview" style="background-image:url('${wp.dataUrl}')"></div>
      <div class="wallpaper-info">
        <div style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_esc(wp.name)}</div>
        <div class="wallpaper-actions">
          <button class="btn-use-wp" data-id="${wp.id}" title="Use Wallpaper" style="flex:1;width:auto;font-size:12px;padding:4px 8px;">Use</button>
          <button class="btn-del-wp" data-id="${wp.id}" title="Delete Wallpaper">🗑</button>
        </div>
      </div>
    `;

    card.querySelector('.btn-use-wp').addEventListener('click', async () => {
      await applyGlobalWallpaper(wp.dataUrl);
    });

    card.querySelector('.btn-del-wp').addEventListener('click', async () => {
      if (confirm('Delete this wallpaper?')) {
        await deleteSavedWallpaper(wp.id);
        await renderWallpaperGallery();
      }
    });

    wallpaperListEl.appendChild(card);
  });
}

// Global wallpaper upload
btnUploadBg.addEventListener('click', () => bgFileInput.click());
bgFileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    const dataUrl = ev.target.result;
    await addSavedWallpaper(dataUrl, file.name.replace(/\.[^/.]+$/, ''));
    await applyGlobalWallpaper(dataUrl);
    await renderWallpaperGallery();
  };
  reader.readAsDataURL(file);
  bgFileInput.value = '';
});

// Per-board wallpaper upload
let _boardWallpaperTarget = null;
const boardWallpaperInput = document.createElement('input');
boardWallpaperInput.type = 'file';
boardWallpaperInput.accept = 'image/*';
boardWallpaperInput.style.display = 'none';
document.body.appendChild(boardWallpaperInput);

function _triggerBoardWallpaperUpload(boardId) {
  _boardWallpaperTarget = boardId;
  boardWallpaperInput.click();
}

boardWallpaperInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !_boardWallpaperTarget) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    applyBoardWallpaper(_boardWallpaperTarget, ev.target.result);
  };
  reader.readAsDataURL(file);
  boardWallpaperInput.value = '';
  _boardWallpaperTarget = null;
});

// ─────────────────────────────────────────────
// BOOKMARK EVENTS (native folders refresh)
// ─────────────────────────────────────────────
chrome.bookmarks.onCreated.addListener(renderAll);
chrome.bookmarks.onRemoved.addListener(renderAll);
chrome.bookmarks.onChanged.addListener(renderAll);
chrome.bookmarks.onMoved.addListener(renderAll);

// ─────────────────────────────────────────────
// UTILITY
// ─────────────────────────────────────────────
function _esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
