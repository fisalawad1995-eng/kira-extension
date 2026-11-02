document.addEventListener('DOMContentLoaded', () => {
  const workspace = document.getElementById('workspace-container');
  const btnHome = document.getElementById('btn-home');
  const btnClear = document.getElementById('btn-clear');
  const btnAddBoard = document.getElementById('btn-add-board');
  
  // Custom Modal Elements
  const addLinkModal = document.getElementById('add-link-modal');
  const addLinkInput = document.getElementById('new-link-url');
  const btnConfirmAdd = document.getElementById('btn-confirm-add');
  const btnCancelAdd = document.getElementById('btn-cancel-add');
  let currentAddTarget = null; // Stores where the new link should go

  // Settings Sidebar Elements
  const settingsPanel = document.getElementById('settings-panel');
  const btnOpenSettings = document.getElementById('btn-open-settings');
  const btnUploadBg = document.getElementById('btn-upload-bg');
  const bgFileInput = document.getElementById('bg-file-input');

  const CUSTOM_BOARDS_KEY = 'customBoards';
  const COLUMN_ORDER_KEY = 'columnOrder';
  
  let bookmarkDragState = null; // For links
  let columnDragState = null;   // For moving entire columns

  // ---------------------------------------------------------------------
  // Background & Settings Sidebar
  // ---------------------------------------------------------------------
  chrome.storage.local.get(['customBg'], (result) => {
    if (result.customBg) document.body.style.backgroundImage = `url('${result.customBg}')`;
  });

  btnOpenSettings.addEventListener('click', () => settingsPanel.classList.toggle('hidden'));
  
  // Close sidebar when clicking outside
  document.addEventListener('click', (e) => {
    if (!settingsPanel.contains(e.target) && !btnOpenSettings.contains(e.target)) {
      settingsPanel.classList.add('hidden');
    }
  });

  btnUploadBg.addEventListener('click', () => bgFileInput.click());
  bgFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(event) {
        const dataUrl = event.target.result;
        chrome.storage.local.set({ customBg: dataUrl }, () => {
          document.body.style.backgroundImage = `url('${dataUrl}')`;
        });
      };
      reader.readAsDataURL(file);
    }
  });

  // ---------------------------------------------------------------------
  // Top bar actions
  // ---------------------------------------------------------------------
  btnHome.addEventListener('click', () => workspace.scrollTo({ left: 0, behavior: 'smooth' }));
  
  btnClear.addEventListener('click', async () => {
    const boards = await loadCustomBoards();
    if (boards.length === 0) return;
    if (confirm('Remove all custom boards?')) {
      await saveCustomBoards([]);
      renderAll();
    }
  });

  btnAddBoard.addEventListener('click', async () => {
    const title = prompt('Board name:');
    if (!title) return;
    const boards = await loadCustomBoards();
    boards.push({ id: 'custom_' + crypto.randomUUID(), title, items: [] });
    await saveCustomBoards(boards);
    renderAll();
  });

  // ---------------------------------------------------------------------
  // Add Link Custom Modal Logic
  // ---------------------------------------------------------------------
  function openAddLinkModal(targetData) {
    currentAddTarget = targetData;
    addLinkInput.value = '';
    addLinkModal.classList.remove('hidden');
    addLinkInput.focus();
  }

  function closeAddLinkModal() {
    addLinkModal.classList.add('hidden');
    currentAddTarget = null;
  }

  btnCancelAdd.addEventListener('click', closeAddLinkModal);
  
  btnConfirmAdd.addEventListener('click', async () => {
    const url = addLinkInput.value.trim();
    if (!url || !currentAddTarget) return;
    
    const finalUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    
    // We assume title is URL or domain for now as requested in minimal UI
    let title;
    try { title = new URL(finalUrl).hostname; } catch { title = finalUrl; }

    if (currentAddTarget.type === 'folder') {
      chrome.bookmarks.create({ parentId: currentAddTarget.id, title, url: finalUrl }, renderAll);
    } else {
      const boards = await loadCustomBoards();
      const b = boards.find(x => x.id === currentAddTarget.id);
      if (b) b.items.push({ id: 'item_' + crypto.randomUUID(), title, url: finalUrl });
      await saveCustomBoards(boards);
      renderAll();
    }
    closeAddLinkModal();
  });

  // ---------------------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------------------
  function loadCustomBoards() {
    return new Promise((resolve) => chrome.storage.local.get([CUSTOM_BOARDS_KEY], (res) => resolve(res[CUSTOM_BOARDS_KEY] || [])));
  }
  function saveCustomBoards(boards) {
    return new Promise((resolve) => chrome.storage.local.set({ [CUSTOM_BOARDS_KEY]: boards }, resolve));
  }
  function loadColumnOrder() {
    return new Promise((resolve) => chrome.storage.local.get([COLUMN_ORDER_KEY], (res) => resolve(res[COLUMN_ORDER_KEY] || [])));
  }
  function saveColumnOrder(orderArr) {
    return new Promise((resolve) => chrome.storage.local.set({ [COLUMN_ORDER_KEY]: orderArr }, resolve));
  }

  // ---------------------------------------------------------------------
  // Rendering & Column Drag Logic
  // ---------------------------------------------------------------------
  function getBookmarkFolders() {
    return new Promise((resolve) => {
      chrome.bookmarks.getTree((tree) => {
        const rootFolders = tree[0].children || [];
        const folders = rootFolders.filter(f => f.children);
        resolve(folders);
      });
    });
  }

  async function renderAll() {
    const scrollLeft = workspace.scrollLeft;
    workspace.innerHTML = '';
    
    const folders = await getBookmarkFolders();
    const customBoards = await loadCustomBoards();
    let columnOrder = await loadColumnOrder();

    if (folders.length === 0 && customBoards.length === 0) {
      workspace.innerHTML = '<div class="empty-hint">No bookmark folders yet. Click "+" to add a custom board.</div>';
      return;
    }

    const allColumns = [];
    
    folders.forEach(folder => {
      const items = folder.children.filter(c => c.url);
      allColumns.push({ id: folder.id, el: buildFolderColumn(folder.title, folder.id, items) });
    });
    
    customBoards.forEach(board => {
      allColumns.push({ id: board.id, el: buildCustomColumn(board) });
    });

    // Sort based on stored order
    allColumns.sort((a, b) => {
      let idxA = columnOrder.indexOf(a.id);
      let idxB = columnOrder.indexOf(b.id);
      if (idxA === -1) idxA = 9999;
      if (idxB === -1) idxB = 9999;
      return idxA - idxB;
    });

    allColumns.forEach(col => workspace.appendChild(col.el));
    workspace.scrollLeft = scrollLeft;
    
    // Attach Drag and Drop for Columns
    setupWorkspaceColumnDrop();
  }

  function setupWorkspaceColumnDrop() {
    workspace.addEventListener('dragover', (e) => {
      if (!columnDragState) return; // Only run if dragging a column
      e.preventDefault();
      
      const afterElement = getDragAfterColumn(workspace, e.clientX);
      const draggable = document.querySelector('.dragging-column');
      if (draggable) {
        if (afterElement == null) {
          workspace.appendChild(draggable);
        } else {
          workspace.insertBefore(draggable, afterElement);
        }
      }
    });

    workspace.addEventListener('drop', async (e) => {
      if (!columnDragState) return;
      e.preventDefault();
      
      // Save new order
      const columns = [...workspace.querySelectorAll('.board-column')];
      const newOrder = columns.map(col => col.dataset.folderId || col.dataset.boardId);
      await saveColumnOrder(newOrder);
      
      document.querySelectorAll('.board-column').forEach(c => {
        c.classList.remove('dragging-column', 'drag-over-column-left', 'drag-over-column-right');
      });
      columnDragState = null;
    });
  }

  function getDragAfterColumn(container, x) {
    const draggableElements = [...container.querySelectorAll('.board-column:not(.dragging-column)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function buildHeader(title, actions) {
    const header = document.createElement('div');
    header.className = 'board-header board-column-header-handle';
    header.title = "Drag to move column";
    
    const titleEl = document.createElement('span');
    titleEl.className = 'board-header-title';
    titleEl.textContent = title;
    header.appendChild(titleEl);
    
    const actionsEl = document.createElement('div');
    actionsEl.className = 'board-header-actions';
    
    const addBtn = document.createElement('button');
    addBtn.className = 'board-header-btn';
    addBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>';
    addBtn.addEventListener('click', (e) => { e.stopPropagation(); actions.onAdd(); });
    actionsEl.appendChild(addBtn);
    
    const moreBtn = document.createElement('button');
    moreBtn.className = 'board-header-btn';
    moreBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>';
    moreBtn.addEventListener('click', (e) => { e.stopPropagation(); actions.onMore(e, moreBtn); });
    actionsEl.appendChild(moreBtn);
    
    header.appendChild(actionsEl);
    return header;
  }

  // ---- Build Columns ----
  function wrapColumnForDrag(column, identifier) {
    column.draggable = true;
    column.addEventListener('dragstart', (e) => {
      // Prevent column drag if dragging a bookmark inside it
      if (e.target.classList.contains('bookmark-item')) {
         return; 
      }
      columnDragState = identifier;
      setTimeout(() => column.classList.add('dragging-column'), 0);
    });
    column.addEventListener('dragend', () => {
      column.classList.remove('dragging-column');
      columnDragState = null;
    });
  }

  function buildFolderColumn(title, folderId, items) {
    const column = document.createElement('div');
    column.className = 'board-column';
    column.dataset.columnType = 'folder';
    column.dataset.folderId = folderId;
    wrapColumnForDrag(column, folderId);

    const header = buildHeader(title, {
      onAdd: () => openAddLinkModal({ type: 'folder', id: folderId }),
      onMore: (e, btn) => showColumnMenu(e, btn, {
        onOpenAll: () => openAllInList(list),
        onRename: () => renameFolder(folderId, title)
      })
    });
    column.appendChild(header);

    const list = document.createElement('div');
    list.className = 'bookmark-list';
    attachListDropZone(list, column, { type: 'folder', folderId });
    items.forEach(item => list.appendChild(buildBookmarkRow(item.title, item.url, {
      itemType: 'folder', itemId: item.id, folderId,
      onDelete: () => { if (confirm(`Remove?`)) chrome.bookmarks.remove(item.id, renderAll); }
    })));
    column.appendChild(list);
    return column;
  }

  function buildCustomColumn(board) {
    const column = document.createElement('div');
    column.className = 'board-column';
    column.dataset.columnType = 'custom';
    column.dataset.boardId = board.id;
    wrapColumnForDrag(column, board.id);

    const header = buildHeader(board.title, {
      onAdd: () => openAddLinkModal({ type: 'custom', id: board.id }),
      onMore: (e, btn) => showColumnMenu(e, btn, {
        onOpenAll: () => openAllInList(list),
        onRename: () => renameCustomBoard(board.id, board.title),
        onDelete: () => deleteCustomBoard(board.id)
      })
    });
    column.appendChild(header);

    const list = document.createElement('div');
    list.className = 'bookmark-list';
    attachListDropZone(list, column, { type: 'custom', boardId: board.id });
    board.items.forEach(item => list.appendChild(buildBookmarkRow(item.title, item.url, {
      itemType: 'custom', itemId: item.id, boardId: board.id,
      onDelete: async () => {
        const boards = await loadCustomBoards();
        const b = boards.find(x => x.id === board.id);
        if (b) b.items = b.items.filter(i => i.id !== item.id);
        await saveCustomBoards(boards);
        renderAll();
      }
    })));
    column.appendChild(list);
    return column;
  }

  // ---- Bookmark row ----
  function buildBookmarkRow(title, url, opts) {
    const wrapper = document.createElement('div');
    wrapper.className = 'bookmark-item';
    wrapper.draggable = true;
    
    const link = document.createElement('a');
    link.className = 'bookmark-link-content';
    link.href = url;
    link.target = '_blank';
    link.innerHTML = `<img class="favicon-img" src="${getFaviconUrl(url)}" alt="" onerror="this.src='https://www.google.com/s2/favicons?domain=google.com'"><span class="bookmark-title"></span>`;
    link.querySelector('.bookmark-title').textContent = title || url;
    
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    actions.innerHTML = `<button class="item-action-btn delete" title="Remove">✖</button>`;
    actions.querySelector('.delete').addEventListener('click', (e) => { e.preventDefault(); opts.onDelete(); });
    
    wrapper.appendChild(link);
    wrapper.appendChild(actions);

    wrapper.addEventListener('dragstart', (e) => {
      e.stopPropagation(); // prevent column drag
      bookmarkDragState = {
        itemId: opts.itemId, itemType: opts.itemType, title, url,
        sourceFolderId: opts.folderId || null, sourceBoardId: opts.boardId || null
      };
      setTimeout(() => wrapper.classList.add('dragging'), 0);
    });
    wrapper.addEventListener('dragend', () => {
      wrapper.classList.remove('dragging');
      bookmarkDragState = null;
    });
    return wrapper;
  }

  function getFaviconUrl(url) {
    try {
      const parsed = new URL(url);
      return `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(parsed.origin)}&size=32`;
    } catch { return 'https://www.google.com/s2/favicons?domain=google.com'; }
  }

  function openAllInList(listEl) {
    const links = [...listEl.querySelectorAll('.bookmark-link-content')];
    if (links.length > 8 && !confirm(`Open ${links.length} tabs?`)) return;
    links.forEach(a => chrome.tabs.create({ url: a.href, active: false }));
  }

  // ---------------------------------------------------------------------
  // Rename / Delete Actions
  // ---------------------------------------------------------------------
  function renameFolder(folderId, currentTitle) {
    const newTitle = prompt('Rename folder:', currentTitle);
    if (newTitle && newTitle.trim()) chrome.bookmarks.update(folderId, { title: newTitle.trim() }, renderAll);
  }
  async function renameCustomBoard(boardId, currentTitle) {
    const newTitle = prompt('Rename board:', currentTitle);
    if (!newTitle || !newTitle.trim()) return;
    const boards = await loadCustomBoards();
    const b = boards.find(x => x.id === boardId);
    if (b) b.title = newTitle.trim();
    await saveCustomBoards(boards);
    renderAll();
  }
  async function deleteCustomBoard(boardId) {
    if (!confirm('Delete this board?')) return;
    const boards = await loadCustomBoards();
    await saveCustomBoards(boards.filter(b => b.id !== boardId));
    renderAll();
  }

  // ---------------------------------------------------------------------
  // Custom Context Menu (Matches WhatsApp Image 10.40.00 PM)
  // ---------------------------------------------------------------------
  function showColumnMenu(e, anchorBtn, handlers) {
    closeAnyOpenMenu();
    const rect = anchorBtn.getBoundingClientRect();
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.top = `${rect.bottom + 6}px`;
    menu.style.left = `${Math.max(8, rect.right - 180)}px`;

    const btnOpen = document.createElement('button');
    btnOpen.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg> Open All Links';
    btnOpen.addEventListener('click', () => { closeAnyOpenMenu(); handlers.onOpenAll(); });
    menu.appendChild(btnOpen);

    const btnFetch = document.createElement('button');
    btnFetch.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg> Fetch All Titles';
    btnFetch.addEventListener('click', () => { closeAnyOpenMenu(); alert('Title fetching utility not configured yet.'); });
    menu.appendChild(btnFetch);

    const btnEdit = document.createElement('button');
    btnEdit.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg> Edit Board';
    btnEdit.addEventListener('click', () => { closeAnyOpenMenu(); handlers.onRename(); });
    menu.appendChild(btnEdit);

    const btnShare = document.createElement('button');
    btnShare.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg> Share Board';
    btnShare.addEventListener('click', () => { closeAnyOpenMenu(); alert('Board details copied to clipboard!'); });
    menu.appendChild(btnShare);

    if (handlers.onDelete) {
      menu.appendChild(document.createElement('hr'));
      const btnDelete = document.createElement('button');
      btnDelete.className = 'danger';
      btnDelete.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg> Delete Board';
      btnDelete.addEventListener('click', () => { closeAnyOpenMenu(); handlers.onDelete(); });
      menu.appendChild(btnDelete);
    }
    
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', closeAnyOpenMenu, { once: true }), 0);
  }

  function closeAnyOpenMenu() { document.querySelectorAll('.context-menu').forEach(m => m.remove()); }

  // ---------------------------------------------------------------------
  // Bookmark Drag & Drop
  // ---------------------------------------------------------------------
  function attachListDropZone(listEl, columnEl, target) {
    listEl.addEventListener('dragover', (e) => {
      if (!bookmarkDragState) return;
      e.preventDefault();
      columnEl.style.borderColor = '#8B5CF6'; // Highlight destination
    });
    listEl.addEventListener('dragleave', () => { columnEl.style.borderColor = ''; });
    listEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      columnEl.style.borderColor = '';
      if (!bookmarkDragState) return;

      const afterEl = getDragAfterElement(listEl, e.clientY);
      const siblings = [...listEl.querySelectorAll('.bookmark-item:not(.dragging)')];
      const dropIndex = afterEl ? siblings.indexOf(afterEl) : siblings.length;

      const source = bookmarkDragState;
      bookmarkDragState = null;

      // Real -> Real
      if (source.itemType === 'folder' && target.type === 'folder') {
        await new Promise(r => chrome.bookmarks.move(source.itemId, { parentId: target.folderId, index: dropIndex }, r));
      }
      // Real -> Custom
      else if (source.itemType === 'folder' && target.type === 'custom') {
        const boards = await loadCustomBoards();
        const b = boards.find(x => x.id === target.boardId);
        if (b) {
          b.items.splice(dropIndex, 0, { id: 'item_' + crypto.randomUUID(), title: source.title, url: source.url });
          await saveCustomBoards(boards);
        }
      }
      // Custom -> Custom
      else if (source.itemType === 'custom' && target.type === 'custom') {
        const boards = await loadCustomBoards();
        const fromBoard = boards.find(x => x.id === source.sourceBoardId);
        const toBoard = boards.find(x => x.id === target.boardId);
        if (fromBoard && toBoard) {
          const idx = fromBoard.items.findIndex(i => i.id === source.itemId);
          if (idx !== -1) {
            const [moved] = fromBoard.items.splice(idx, 1);
            toBoard.items.splice(dropIndex, 0, moved);
            await saveCustomBoards(boards);
          }
        }
      }
      // Custom -> Real
      else if (source.itemType === 'custom' && target.type === 'folder') {
        await new Promise(r => chrome.bookmarks.create({ parentId: target.folderId, title: source.title, url: source.url, index: dropIndex }, r));
        const boards = await loadCustomBoards();
        const b = boards.find(x => x.id === source.sourceBoardId);
        if (b) b.items = b.items.filter(i => i.id !== source.itemId);
        await saveCustomBoards(boards);
      }
      renderAll();
    });
  }

  function getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.bookmark-item:not(.dragging)')];
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  // ---------------------------------------------------------------------
  // Listeners
  // ---------------------------------------------------------------------
  chrome.bookmarks.onCreated.addListener(renderAll);
  chrome.bookmarks.onRemoved.addListener(renderAll);
  chrome.bookmarks.onChanged.addListener(renderAll);
  chrome.bookmarks.onMoved.addListener(renderAll);
  renderAll();
});