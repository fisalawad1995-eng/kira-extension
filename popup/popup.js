import { init as initDB, DB } from '../db/indexeddb.js';

let tabTitle = 'Untitled';
let tabUrl = '';
let favUrl = '';

chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
  if (tabs && tabs[0]) {
    tabTitle = tabs[0].title || 'Untitled';
    tabUrl = tabs[0].url || '';
    favUrl = tabs[0].favIconUrl || '';
  }

  document.getElementById('tab-title').textContent = tabTitle;
  document.getElementById('tab-url').textContent = tabUrl;

  const favImg = document.getElementById('favicon');
  let hostname = '';
  try { hostname = new URL(tabUrl).hostname; } catch {}
  const fallbackFav = hostname ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=32` : '';

  favImg.dataset.fallback = fallbackFav;
  favImg.onerror = function() {
    if (!this.dataset.tried && this.dataset.fallback) {
      this.dataset.tried = '1';
      this.src = this.dataset.fallback;
    } else {
      this.style.display = 'none';
    }
  };
  favImg.src = favUrl || fallbackFav || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';

  const boardSelect = document.getElementById('board-select');
  const pageSelect  = document.getElementById('page-select');
  const dupeWarn    = document.getElementById('dupe-warning');
  const btnSave     = document.getElementById('btn-save');
  const btnCancel   = document.getElementById('btn-cancel');
  const savedMsg    = document.getElementById('saved-msg');

  try {
    await initDB();

    const boards = await DB.boards.getAll();
    boards.forEach(b => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = b.title;
      boardSelect.appendChild(opt);
    });

    async function loadPages(boardId) {
      pageSelect.innerHTML = '';
      const pages = await DB.pages.getForBoard(boardId);
      pages.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.title;
        pageSelect.appendChild(opt);
      });
      if (pages.length) await checkDupe(pages[0].id);
    }

    async function checkDupe(pageId) {
      if (!pageId || !tabUrl) return;
      const dupes = await DB.bookmarks.findByUrl(tabUrl, pageId);
      dupeWarn.classList.toggle('show', dupes.length > 0);
    }

    if (boards.length) await loadPages(boards[0].id);

    boardSelect.addEventListener('change', () => loadPages(boardSelect.value));
    pageSelect.addEventListener('change', () => checkDupe(pageSelect.value));

    const btnStashAll = document.getElementById('btn-stash-all-popup');

    btnSave.addEventListener('click', async () => {
      const pageId = pageSelect.value;
      if (!pageId || !tabUrl) return;
      await DB.bookmarks.create(pageId, { url: tabUrl, title: tabTitle, favicon: favUrl });
      document.querySelector('.actions').style.display = 'none';
      if (btnStashAll) btnStashAll.style.display = 'none';
      document.querySelector('.dupe-warning').style.display = 'none';
      savedMsg.style.display = 'block';
      setTimeout(() => window.close(), 1200);
    });

    if (btnStashAll) {
      btnStashAll.addEventListener('click', () => {
        chrome.tabs.query({ currentWindow: true }, async (winTabs) => {
          const extUrl = chrome.runtime.getURL('');
          const validTabs = (winTabs || []).filter(t => t.url && !t.url.startsWith('chrome://newtab') && !t.url.startsWith(extUrl));
          if (!validTabs.length) return;
          const nowStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          const board = await DB.boards.create(`Session — ${nowStr}`);
          const page = await DB.pages.create(board.id, 'Main');
          for (const t of validTabs) {
            await DB.bookmarks.create(page.id, { url: t.url, title: t.title || t.url, favicon: t.favIconUrl || '' });
          }
          document.querySelector('.actions').style.display = 'none';
          btnStashAll.style.display = 'none';
          document.querySelector('.dupe-warning').style.display = 'none';
          savedMsg.innerHTML = `<span>✓</span>Stashed ${validTabs.length} tabs!`;
          savedMsg.style.display = 'block';
          setTimeout(() => window.close(), 1200);
        });
      });
    }

    btnCancel.addEventListener('click', () => window.close());
  } catch (err) {
    document.getElementById('tab-title').textContent = "Error: " + err.message;
  }
});
