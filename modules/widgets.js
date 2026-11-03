// Board Tab — Productivity & Ambient Widgets + Session Stash Module
// Handles:
// 1. Aesthetic Minimalist Clock & Personalized Greeting
// 2. Live Weather Badge (Open-Meteo API with caching & city search)
// 3. Floating Quick Scratchpad & Daily To-Do Checklist Widget
// 4. "Save All Open Tabs" Session Stash Modal & Quick Stash

import { DB } from '../db/indexeddb.js';
import { createFaviconImg, getFaviconUrl, maxZIndex, setMaxZIndex } from './boards.js';
import { search } from './search.js';

// ─────────────────────────────────────────────
// 1. AMBIENT CLOCK & GREETING
// ─────────────────────────────────────────────
let _clockInterval = null;
let _is24Hour = false;
let _userName = '';

export async function initAmbientClock() {
  const clockContainer = document.getElementById('ambient-clock-widget');
  const timeEl = document.getElementById('ambient-time');
  const dateEl = document.getElementById('ambient-date');
  const showClockCheckbox = document.getElementById('show-clock-checkbox');

  if (!clockContainer || !timeEl) return;

  const [saved24h, showClock] = await Promise.all([
    DB.settings.get('clock_24h'),
    DB.settings.get('show_ambient_clock')
  ]);

  _is24Hour = saved24h !== null ? !!saved24h : false;
  const isVisible = showClock !== null ? !!showClock : true;

  clockContainer.classList.toggle('hidden', !isVisible);
  if (showClockCheckbox) {
    showClockCheckbox.checked = isVisible;
    showClockCheckbox.addEventListener('change', async () => {
      const visible = showClockCheckbox.checked;
      clockContainer.classList.toggle('hidden', !visible);
      await DB.settings.set('show_ambient_clock', visible);
    });
  }

  const updateClock = () => {
    const now = new Date();
    const hours24 = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');

    if (_is24Hour) {
      timeEl.textContent = `${String(hours24).padStart(2, '0')}:${minutes}`;
    } else {
      const period = hours24 >= 12 ? 'PM' : 'AM';
      const hours12 = hours24 % 12 || 12;
      timeEl.innerHTML = `${hours12}:${minutes} <span class="ambient-ampm">${period}</span>`;
    }

    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      });
    }
  };

  // Toggle 12h / 24h on clicking the clock pill
  clockContainer.addEventListener('click', async () => {
    _is24Hour = !_is24Hour;
    await DB.settings.set('clock_24h', _is24Hour);
    updateClock();
  });

  updateClock();
  if (_clockInterval) clearInterval(_clockInterval);
  _clockInterval = setInterval(updateClock, 10000);
}

// ─────────────────────────────────────────────
// 2. LIVE WEATHER BADGE
// ─────────────────────────────────────────────
const WEATHER_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const WMO_ICONS = {
  0: { icon: '☀️', label: 'Clear' },
  1: { icon: '🌤️', label: 'Mostly Clear' },
  2: { icon: '⛅', label: 'Partly Cloudy' },
  3: { icon: '☁️', label: 'Overcast' },
  45: { icon: '🌫️', label: 'Foggy' },
  48: { icon: '🌫️', label: 'Fog' },
  51: { icon: '🌦️', label: 'Light Drizzle' },
  53: { icon: '🌦️', label: 'Drizzle' },
  55: { icon: '🌧️', label: 'Heavy Drizzle' },
  61: { icon: '🌧️', label: 'Light Rain' },
  63: { icon: '🌧️', label: 'Rain' },
  65: { icon: '🌧️', label: 'Heavy Rain' },
  71: { icon: '🌨️', label: 'Light Snow' },
  73: { icon: '🌨️', label: 'Snow' },
  75: { icon: '❄️', label: 'Heavy Snow' },
  80: { icon: '🌦️', label: 'Rain Showers' },
  81: { icon: '🌧️', label: 'Showers' },
  82: { icon: '⛈️', label: 'Heavy Showers' },
  95: { icon: '⛈️', label: 'Thunderstorm' },
  96: { icon: '⛈️', label: 'Storm' },
  99: { icon: '⛈️', label: 'Severe Storm' }
};

export async function initWeatherWidget() {
  const badge = document.getElementById('weather-badge');
  const showWeatherCheckbox = document.getElementById('show-weather-checkbox');
  if (!badge) return;

  const showWeather = await DB.settings.get('show_weather_badge');
  const isVisible = showWeather !== null ? !!showWeather : true;
  badge.classList.toggle('hidden', !isVisible);

  if (showWeatherCheckbox) {
    showWeatherCheckbox.checked = isVisible;
    showWeatherCheckbox.addEventListener('change', async () => {
      const visible = showWeatherCheckbox.checked;
      badge.classList.toggle('hidden', !visible);
      await DB.settings.set('show_weather_badge', visible);
      if (visible) _loadAndRenderWeather(badge);
    });
  }

  badge.addEventListener('click', async () => {
    const savedLoc = (await DB.settings.get('weather_location')) || { name: 'Baghdad' };
    const cityInput = prompt('Enter city name for live weather (e.g. Baghdad, London, Dubai, New York):', savedLoc.name || '');
    if (!cityInput || !cityInput.trim()) return;
    badge.innerHTML = `<span class="weather-icon">⏳</span><span class="weather-temp">Locating…</span>`;
    try {
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityInput.trim())}&count=1&language=en&format=json`);
      const geoData = await geoRes.json();
      if (geoData.results && geoData.results.length > 0) {
        const loc = geoData.results[0];
        const newLoc = {
          name: loc.name,
          lat: loc.latitude,
          lon: loc.longitude
        };
        await DB.settings.set('weather_location', newLoc);
        await DB.settings.set('weather_cache', null);
        await _loadAndRenderWeather(badge, true);
      } else {
        alert(`Could not find city "${cityInput}".`);
        await _loadAndRenderWeather(badge, false);
      }
    } catch (err) {
      console.error('Weather geocoding error:', err);
      await _loadAndRenderWeather(badge, false);
    }
  });

  if (isVisible) {
    await _loadAndRenderWeather(badge, false);
  }
}

async function _loadAndRenderWeather(badge, forceRefresh = false) {
  try {
    const cached = await DB.settings.get('weather_cache');
    if (!forceRefresh && cached && (Date.now() - cached.timestamp < WEATHER_CACHE_TTL)) {
      _renderWeatherBadge(badge, cached);
      return;
    }

    let loc = await DB.settings.get('weather_location');
    if (!loc || typeof loc.lat !== 'number') {
      // Default fallback location (Baghdad) if geolocation not set
      loc = { name: 'Baghdad', lat: 33.3152, lon: 44.3661 };
      await DB.settings.set('weather_location', loc);
    }

    const url = `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Weather fetch failed');
    const data = await res.json();

    if (data && data.current_weather) {
      const cw = data.current_weather;
      const wmo = WMO_ICONS[cw.weathercode] || { icon: '🌡️', label: 'Weather' };
      const weatherPayload = {
        temp: Math.round(cw.temperature),
        icon: wmo.icon,
        label: wmo.label,
        city: loc.name,
        timestamp: Date.now()
      };
      await DB.settings.set('weather_cache', weatherPayload);
      _renderWeatherBadge(badge, weatherPayload);
    }
  } catch {
    const cached = await DB.settings.get('weather_cache');
    if (cached) {
      _renderWeatherBadge(badge, cached);
    } else {
      badge.innerHTML = `<span class="weather-icon">🌤️</span><span class="weather-temp">Set City</span>`;
    }
  }
}

function _renderWeatherBadge(badge, data) {
  badge.title = `${data.city}: ${data.label} (${data.temp}°C) — Click to change city`;
  badge.innerHTML = `
    <span class="weather-icon">${data.icon}</span>
    <span class="weather-temp">${data.temp}°C</span>
    <span class="weather-city">${_esc(data.city)}</span>
  `;
}

// ─────────────────────────────────────────────
// 3. QUICK SCRATCHPAD & DAILY TO-DO WIDGET
// ─────────────────────────────────────────────
export async function initScratchpadWidget() {
  const widget = document.getElementById('scratchpad-widget');
  const btnToggle = document.getElementById('btn-notes-toggle');
  const btnClose = document.getElementById('btn-scratchpad-close');
  const headerHandle = document.getElementById('scratchpad-header');
  const tabBtns = document.querySelectorAll('.scratchpad-tab-btn');
  const notesPane = document.getElementById('scratchpad-notes-pane');
  const todosPane = document.getElementById('scratchpad-todos-pane');
  const textarea = document.getElementById('scratchpad-textarea');
  const charCount = document.getElementById('scratchpad-char-count');
  const btnCopyNotes = document.getElementById('btn-scratchpad-copy');
  const btnClearNotes = document.getElementById('btn-scratchpad-clear');
  const todoInput = document.getElementById('scratchpad-todo-input');
  const btnAddTodo = document.getElementById('btn-scratchpad-add-todo');
  const todoListEl = document.getElementById('scratchpad-todo-list');
  const btnClearDone = document.getElementById('btn-scratchpad-clear-done');
  const todoCountBadge = document.getElementById('scratchpad-todo-badge');

  if (!widget || !btnToggle) return;

  // Load persisted state
  const state = (await DB.settings.get('scratchpad_state')) || {
    open: false,
    activeTab: 'notes',
    x: null,
    y: null
  };
  const savedText = (await DB.settings.get('scratchpad_text')) || '';
  let todos = (await DB.settings.get('scratchpad_todos')) || [];

  // Apply position if saved
  if (typeof state.x === 'number' && typeof state.y === 'number') {
    widget.style.left = `${ Math.max(12, Math.min(window.innerWidth - 320, state.x)) }px`;
    widget.style.top = `${ Math.max(60, Math.min(window.innerHeight - 200, state.y)) }px`;
    widget.style.right = 'auto';
    widget.style.bottom = 'auto';
  }

  const setOpenState = async (isOpen) => {
    state.open = isOpen;
    widget.classList.toggle('hidden', !isOpen);
    btnToggle.classList.toggle('active-widget-btn', isOpen);
    await DB.settings.set('scratchpad_state', state);
  };

  await setOpenState(!!state.open);

  btnToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpenState(!state.open);
  });

  if (btnClose) {
    btnClose.addEventListener('click', () => setOpenState(false));
  }

  // Switch tabs (Notes vs Tasks)
  const switchTab = async (tabName) => {
    state.activeTab = tabName;
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    if (notesPane) notesPane.classList.toggle('hidden', tabName !== 'notes');
    if (todosPane) todosPane.classList.toggle('hidden', tabName !== 'todos');
    await DB.settings.set('scratchpad_state', state);
  };

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
  await switchTab(state.activeTab || 'notes');

  // Notes logic
  if (textarea) {
    textarea.value = savedText;
    const updateStats = () => {
      const len = textarea.value.length;
      const words = textarea.value.trim() ? textarea.value.trim().split(/\s+/).length : 0;
      if (charCount) charCount.textContent = `${words} words · ${len} chars`;
    };
    updateStats();

    let saveTimer = null;
    textarea.addEventListener('input', () => {
      updateStats();
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        DB.settings.set('scratchpad_text', textarea.value);
      }, 200);
    });
  }

  if (btnCopyNotes && textarea) {
    btnCopyNotes.addEventListener('click', async () => {
      await navigator.clipboard.writeText(textarea.value);
      const orig = btnCopyNotes.textContent;
      btnCopyNotes.textContent = 'Copied!';
      setTimeout(() => { btnCopyNotes.textContent = orig; }, 1200);
    });
  }

  if (btnClearNotes && textarea) {
    btnClearNotes.addEventListener('click', async () => {
      if (!textarea.value) return;
      if (confirm('Clear all scratchpad notes?')) {
        textarea.value = '';
        await DB.settings.set('scratchpad_text', '');
        if (charCount) charCount.textContent = '0 words · 0 chars';
      }
    });
  }

  // To-Do Checklist logic
  const saveAndRenderTodos = async () => {
    await DB.settings.set('scratchpad_todos', todos);
    if (!todoListEl) return;
    todoListEl.innerHTML = '';

    const remaining = todos.filter(t => !t.done).length;
    if (todoCountBadge) {
      todoCountBadge.textContent = remaining;
      todoCountBadge.classList.toggle('hidden', remaining === 0);
    }

    if (todos.length === 0) {
      todoListEl.innerHTML = '<div class="scratchpad-empty">No tasks yet — add one above! ✨</div>';
      return;
    }

    todos.forEach(todo => {
      const row = document.createElement('div');
      row.className = 'scratchpad-todo-item' + (todo.done ? ' done' : '');
      row.innerHTML = `
        <label class="scratchpad-todo-label">
          <input type="checkbox" class="scratchpad-todo-check" ${todo.done ? 'checked' : ''}>
          <span class="scratchpad-todo-text">${_esc(todo.text)}</span>
        </label>
        <button class="scratchpad-todo-del" title="Remove task">✖</button>
      `;

      row.querySelector('.scratchpad-todo-check').addEventListener('change', (e) => {
        todo.done = e.target.checked;
        saveAndRenderTodos();
      });

      row.querySelector('.scratchpad-todo-del').addEventListener('click', () => {
        todos = todos.filter(t => t.id !== todo.id);
        saveAndRenderTodos();
      });

      todoListEl.appendChild(row);
    });
  };

  const addTodo = () => {
    if (!todoInput) return;
    const text = todoInput.value.trim();
    if (!text) return;
    todos.push({
      id: 'todo_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      text,
      done: false
    });
    todoInput.value = '';
    saveAndRenderTodos();
  };

  if (btnAddTodo) btnAddTodo.addEventListener('click', addTodo);
  if (todoInput) {
    todoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addTodo();
    });
  }

  if (btnClearDone) {
    btnClearDone.addEventListener('click', () => {
      todos = todos.filter(t => !t.done);
      saveAndRenderTodos();
    });
  }

  await saveAndRenderTodos();

  // Draggable header
  if (headerHandle) {
    let dragging = false;
    let startX = 0, startY = 0, origLeft = 0, origTop = 0;

    headerHandle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      dragging = true;
      const rect = widget.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      origLeft = rect.left;
      origTop = rect.top;
      widget.style.left = `${origLeft}px`;
      widget.style.top = `${origTop}px`;
      widget.style.right = 'auto';
      widget.style.bottom = 'auto';
      headerHandle.setPointerCapture(e.pointerId);
      e.preventDefault();
    });

    headerHandle.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const nx = Math.max(8, Math.min(window.innerWidth - widget.offsetWidth - 8, origLeft + (e.clientX - startX)));
      const ny = Math.max(8, Math.min(window.innerHeight - widget.offsetHeight - 8, origTop + (e.clientY - startY)));
      widget.style.left = `${nx}px`;
      widget.style.top = `${ny}px`;
    });

    const endDrag = async (e) => {
      if (!dragging) return;
      dragging = false;
      headerHandle.releasePointerCapture(e.pointerId);
      state.x = parseInt(widget.style.left, 10);
      state.y = parseInt(widget.style.top, 10);
      await DB.settings.set('scratchpad_state', state);
    };

    headerHandle.addEventListener('pointerup', endDrag);
    headerHandle.addEventListener('pointercancel', endDrag);
  }
}

// ─────────────────────────────────────────────
// 4. "SAVE ALL OPEN TABS" (ONE-CLICK SESSION STASH)
// ─────────────────────────────────────────────
export function initSessionStash(onRefreshWorkspace) {
  const btnStashTabs = document.getElementById('btn-stash-tabs');
  const stashCountBadge = document.getElementById('stash-tab-count');
  const stashModal = document.getElementById('stash-tabs-modal');
  const stashTabList = document.getElementById('stash-tabs-list');
  const stashSelectAllBtn = document.getElementById('btn-stash-select-all');
  const stashTargetRadios = document.querySelectorAll('input[name="stash-target-type"]');
  const stashNewBoardGroup = document.getElementById('stash-new-board-group');
  const stashExistingBoardGroup = document.getElementById('stash-existing-board-group');
  const stashBoardTitleInput = document.getElementById('stash-board-title');
  const stashBoardSelect = document.getElementById('stash-board-select');
  const stashPageTitleInput = document.getElementById('stash-page-title');
  const stashCloseTabsCheckbox = document.getElementById('stash-close-tabs-checkbox');
  const btnConfirmStash = document.getElementById('btn-confirm-stash');
  const btnCancelStash = document.getElementById('btn-cancel-stash');

  if (!btnStashTabs || !stashModal) return;

  let currentStashingTabs = [];

  const getStashableTabs = () => {
    return new Promise((resolve) => {
      if (!chrome?.tabs?.query) { resolve([]); return; }
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const extUrl = chrome.runtime.getURL('');
        const filtered = (tabs || []).filter(t => {
          if (!t.url) return false;
          if (t.url.startsWith('chrome://newtab') || t.url.startsWith('edge://newtab')) return false;
          if (t.url.startsWith(extUrl)) return false;
          return true;
        });
        resolve(filtered);
      });
    });
  };

  const updateBadgeCount = async () => {
    const tabs = await getStashableTabs();
    if (stashCountBadge) {
      stashCountBadge.textContent = tabs.length;
      stashCountBadge.classList.toggle('hidden', tabs.length === 0);
    }
  };

  updateBadgeCount();
  if (chrome?.tabs) {
    chrome.tabs.onCreated?.addListener(updateBadgeCount);
    chrome.tabs.onRemoved?.addListener(updateBadgeCount);
    chrome.tabs.onUpdated?.addListener(updateBadgeCount);
  }

  // Switch between "New Board" and "Existing Board"
  stashTargetRadios.forEach(radio => {
    radio.addEventListener('change', () => {
      const isNew = radio.value === 'new' && radio.checked;
      if (stashNewBoardGroup) stashNewBoardGroup.classList.toggle('hidden', !isNew);
      if (stashExistingBoardGroup) stashExistingBoardGroup.classList.toggle('hidden', isNew);
    });
  });

  // Open Stash Modal
  btnStashTabs.addEventListener('click', async () => {
    currentStashingTabs = await getStashableTabs();
    const nowStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    if (stashBoardTitleInput) stashBoardTitleInput.value = `Session — ${nowStr}`;
    if (stashPageTitleInput) stashPageTitleInput.value = `Tabs (${nowStr})`;

    // Populate existing boards dropdown
    const boards = await DB.boards.getAll();
    if (stashBoardSelect) {
      stashBoardSelect.innerHTML = '';
      boards.forEach(b => {
        const opt = document.createElement('option');
        opt.value = b.id;
        opt.textContent = b.title;
        stashBoardSelect.appendChild(opt);
      });
    }

    // Render tab checklist
    stashTabList.innerHTML = '';
    if (currentStashingTabs.length === 0) {
      stashTabList.innerHTML = '<div class="stash-empty-msg">No other open tabs in this window to stash!</div>';
      btnConfirmStash.disabled = true;
    } else {
      btnConfirmStash.disabled = false;
      currentStashingTabs.forEach((tab) => {
        const row = document.createElement('label');
        row.className = 'stash-tab-row';
        const fav = createFaviconImg(tab.url, 'favicon-img');
        const check = document.createElement('input');
        check.type = 'checkbox';
        check.className = 'stash-tab-check';
        check.checked = true;
        check.dataset.tabId = tab.id;
        check.dataset.url = tab.url;
        check.dataset.title = tab.title || tab.url;

        const info = document.createElement('div');
        info.className = 'stash-tab-info';
        info.innerHTML = `
          <div class="stash-tab-title">${_esc(tab.title || tab.url)}</div>
          <div class="stash-tab-url">${_esc(tab.url)}</div>
        `;

        row.appendChild(check);
        row.appendChild(fav);
        row.appendChild(info);
        stashTabList.appendChild(row);
      });
    }

    stashModal.classList.remove('hidden');
  });

  // Select All / Deselect All
  if (stashSelectAllBtn) {
    stashSelectAllBtn.addEventListener('click', () => {
      const checks = [...stashTabList.querySelectorAll('.stash-tab-check')];
      const allChecked = checks.every(c => c.checked);
      checks.forEach(c => { c.checked = !allChecked; });
      stashSelectAllBtn.textContent = allChecked ? 'Select All' : 'Deselect All';
    });
  }

  // Cancel
  if (btnCancelStash) {
    btnCancelStash.addEventListener('click', () => stashModal.classList.add('hidden'));
  }
  stashModal.addEventListener('click', (e) => {
    if (e.target === stashModal) stashModal.classList.add('hidden');
  });

  // Confirm Stash
  if (btnConfirmStash) {
    btnConfirmStash.addEventListener('click', async () => {
      const selectedChecks = [...stashTabList.querySelectorAll('.stash-tab-check:checked')];
      if (!selectedChecks.length) return;

      const targetType = [...stashTargetRadios].find(r => r.checked)?.value || 'new';
      let targetPageId = null;

      if (targetType === 'new') {
        const boardTitle = (stashBoardTitleInput?.value || '').trim() || 'Saved Session';
        const board = await DB.boards.create(boardTitle);
        const page = await DB.pages.create(board.id, 'Main');
        targetPageId = page.id;
      } else {
        const boardId = stashBoardSelect?.value;
        if (!boardId) {
          const board = await DB.boards.create('Saved Session');
          const page = await DB.pages.create(board.id, 'Main');
          targetPageId = page.id;
        } else {
          const pageTitle = (stashPageTitleInput?.value || '').trim() || 'Stashed Tabs';
          const page = await DB.pages.create(boardId, pageTitle);
          targetPageId = page.id;
        }
      }

      const tabIdsToClose = [];
      for (const chk of selectedChecks) {
        const url = chk.dataset.url;
        const title = chk.dataset.title;
        await DB.bookmarks.create(targetPageId, {
          url,
          title,
          favicon: getFaviconUrl(url)
        });
        if (chk.dataset.tabId) {
          tabIdsToClose.push(Number(chk.dataset.tabId));
        }
      }

      if (stashCloseTabsCheckbox?.checked && tabIdsToClose.length > 0 && chrome?.tabs?.remove) {
        chrome.tabs.remove(tabIdsToClose);
      }

      stashModal.classList.add('hidden');
      await updateBadgeCount();
      if (onRefreshWorkspace) await onRefreshWorkspace();
    });
  }
}

// ─────────────────────────────────────────────
// 5. POWER-USER SPOTLIGHT COMMAND PALETTE & GLOBAL HOTKEYS
// ─────────────────────────────────────────────
export function initSpotlightAndShortcuts(actions) {
  const spotlightModal = document.getElementById('spotlight-modal');
  const spotlightInput = document.getElementById('spotlight-input');
  const spotlightList = document.getElementById('spotlight-results-list');
  const btnOpenSpotlight = document.getElementById('btn-spotlight-open');

  if (!spotlightModal || !spotlightInput || !spotlightList) return;

  let activeIndex = 0;
  let currentItems = [];

  const getCommands = () => [
    {
      type: 'command',
      icon: '✨',
      title: 'Tidy Up / Auto-Align Canvas',
      subtitle: 'Neatly pack and align all free-canvas cards',
      shortcut: 'T',
      run: () => actions.onTidyUp && actions.onTidyUp()
    },
    {
      type: 'command',
      icon: '➕',
      title: 'Create New Board',
      subtitle: 'Add a custom board column to your workspace',
      shortcut: 'B',
      run: () => actions.onNewBoard && actions.onNewBoard()
    },
    {
      type: 'command',
      icon: '⚡',
      title: 'Stash All Open Tabs',
      subtitle: 'Save open tabs in this window into a board',
      shortcut: 'S',
      run: () => actions.onStashTabs && actions.onStashTabs()
    },
    {
      type: 'command',
      icon: '📝',
      title: 'Toggle Quick Scratchpad & Tasks',
      subtitle: 'Open or close the floating notes & checklist widget',
      shortcut: 'N',
      run: () => actions.onToggleNotes && actions.onToggleNotes()
    },
    {
      type: 'command',
      icon: '👁️',
      title: 'Toggle Privacy Blur Mode',
      subtitle: 'Blur or unblur bookmark titles for screen sharing',
      shortcut: 'P',
      run: () => actions.onToggleBlur && actions.onToggleBlur()
    },
    {
      type: 'command',
      icon: '🔀',
      title: 'Switch Layout Mode (Free Canvas / Smooth Grid)',
      subtitle: 'Toggle between freeform canvas and magnetic grid',
      shortcut: '',
      run: () => actions.onToggleLayout && actions.onToggleLayout()
    },
    {
      type: 'command',
      icon: '🌓',
      title: 'Toggle Dark / Light Theme',
      subtitle: 'Switch workspace appearance mode',
      shortcut: '',
      run: () => actions.onToggleTheme && actions.onToggleTheme()
    },
    {
      type: 'command',
      icon: '📥',
      title: 'Import Bookmarks',
      subtitle: 'Import from Chrome, HTML file, or JSON backup',
      shortcut: '',
      run: () => actions.onOpenImport && actions.onOpenImport()
    },
    {
      type: 'command',
      icon: '🗑️',
      title: 'Open Trash',
      subtitle: 'Restore or permanently delete trashed items',
      shortcut: '',
      run: () => actions.onOpenTrash && actions.onOpenTrash()
    }
  ];

  const getBoardEntries = () => {
    const cols = [...document.querySelectorAll('.board-column')];
    return cols.map(col => {
      const titleEl = col.querySelector('.board-header-title');
      const title = titleEl ? titleEl.textContent.trim() : 'Board';
      const isFolder = col.dataset.columnType === 'folder';
      const linkCount = col.querySelectorAll('.bookmark-link-content').length;
      return {
        type: 'board',
        icon: isFolder ? '📁' : '📋',
        title,
        subtitle: `${isFolder ? 'Chrome Folder' : 'Custom Board'} · ${linkCount} links`,
        shortcut: 'Jump / Shift+↵ Open All',
        colEl: col
      };
    });
  };

  const openSpotlight = (initialValue = '') => {
    spotlightModal.classList.remove('hidden');
    spotlightInput.value = initialValue;
    renderSpotlightResults();
    setTimeout(() => spotlightInput.focus(), 20);
  };

  const closeSpotlight = () => {
    spotlightModal.classList.add('hidden');
    spotlightInput.value = '';
  };

  if (btnOpenSpotlight) {
    btnOpenSpotlight.addEventListener('click', () => openSpotlight(''));
  }

  spotlightModal.addEventListener('click', (e) => {
    if (e.target === spotlightModal) closeSpotlight();
  });

  const renderSpotlightResults = () => {
    const raw = spotlightInput.value;
    const q = raw.trim();
    spotlightList.innerHTML = '';
    currentItems = [];
    activeIndex = 0;

    if (!q) {
      // Show Quick Commands + top Boards when empty
      currentItems = [
        ...getCommands().slice(0, 6),
        ...getBoardEntries().slice(0, 4)
      ];
    } else if (q.startsWith('>')) {
      const cmdQuery = q.slice(1).trim().toLowerCase();
      currentItems = getCommands().filter(c =>
        c.title.toLowerCase().includes(cmdQuery) || c.subtitle.toLowerCase().includes(cmdQuery)
      );
    } else if (q.startsWith('#')) {
      const boardQuery = q.slice(1).trim().toLowerCase();
      currentItems = getBoardEntries().filter(b =>
        b.title.toLowerCase().includes(boardQuery)
      );
    } else {
      const bkResults = search(q).slice(0, 15).map(r => ({
        type: 'bookmark',
        title: r.title || r.url,
        subtitle: `${r.board_title} › ${r.page_title}`,
        url: r.url,
        shortcut: '↵ Open'
      }));
      const qLower = q.toLowerCase();
      const matchingBoards = getBoardEntries().filter(b => b.title.toLowerCase().includes(qLower)).slice(0, 3);
      const matchingCmds = getCommands().filter(c => c.title.toLowerCase().includes(qLower)).slice(0, 3);
      currentItems = [...bkResults, ...matchingBoards, ...matchingCmds];
    }

    if (currentItems.length === 0) {
      spotlightList.innerHTML = `<div class="spotlight-empty">No matching bookmarks, boards (#), or commands (>) found</div>`;
      return;
    }

    currentItems.forEach((item, idx) => {
      const row = document.createElement('div');
      row.className = 'spotlight-item' + (idx === activeIndex ? ' active' : '');

      let leadingEl;
      if (item.type === 'bookmark') {
        leadingEl = createFaviconImg(item.url, 'spotlight-favicon');
      } else {
        leadingEl = document.createElement('span');
        leadingEl.className = 'spotlight-emoji-icon';
        leadingEl.textContent = item.icon || '⚡';
      }

      const info = document.createElement('div');
      info.className = 'spotlight-item-info';
      info.innerHTML = `
        <div class="spotlight-item-title">${_esc(item.title)}</div>
        <div class="spotlight-item-sub">${_esc(item.subtitle || '')}</div>
      `;

      const badge = document.createElement('span');
      badge.className = 'spotlight-item-badge';
      badge.textContent = item.shortcut || '';

      row.appendChild(leadingEl);
      row.appendChild(info);
      if (item.shortcut) row.appendChild(badge);

      row.addEventListener('mouseenter', () => {
        activeIndex = idx;
        _updateSelection();
      });

      row.addEventListener('click', (e) => {
        _executeItem(item, e.shiftKey || e.ctrlKey || e.metaKey);
      });

      spotlightList.appendChild(row);
    });
  };

  const _updateSelection = () => {
    const rows = spotlightList.querySelectorAll('.spotlight-item');
    rows.forEach((r, idx) => {
      r.classList.toggle('active', idx === activeIndex);
      if (idx === activeIndex) {
        r.scrollIntoView({ block: 'nearest' });
      }
    });
  };

  const _executeItem = (item, modKey = false) => {
    if (!item) return;
    if (item.type === 'bookmark') {
      if (modKey) {
        chrome.tabs.create({ url: item.url, active: false });
      } else {
        closeSpotlight();
        window.open(item.url, '_blank');
      }
    } else if (item.type === 'board') {
      closeSpotlight();
      const col = item.colEl;
      if (!col) return;
      if (modKey) {
        const openBtn = col.querySelector('.board-open-all-btn');
        if (openBtn) openBtn.click();
      } else {
        col.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
        const nextZ = maxZIndex + 1;
        setMaxZIndex(nextZ);
        if (col.style.zIndex) col.style.zIndex = nextZ;
        col.classList.add('spotlight-pulse-board');
        setTimeout(() => col.classList.remove('spotlight-pulse-board'), 1500);
      }
    } else if (item.type === 'command') {
      closeSpotlight();
      if (item.run) item.run();
    }
  };

  spotlightInput.addEventListener('input', renderSpotlightResults);

  spotlightInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (currentItems.length) {
        activeIndex = (activeIndex + 1) % currentItems.length;
        _updateSelection();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (currentItems.length) {
        activeIndex = (activeIndex - 1 + currentItems.length) % currentItems.length;
        _updateSelection();
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentItems[activeIndex]) {
        _executeItem(currentItems[activeIndex], e.shiftKey || e.ctrlKey || e.metaKey);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeSpotlight();
    }
  });

  // Global Hotkeys
  document.addEventListener('keydown', (e) => {
    // Ctrl+K or Cmd+K always toggles Spotlight
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      if (spotlightModal.classList.contains('hidden')) {
        openSpotlight('');
      } else {
        closeSpotlight();
      }
      return;
    }

    // Escape closes open overlays
    if (e.key === 'Escape') {
      if (!spotlightModal.classList.contains('hidden')) {
        closeSpotlight();
        return;
      }
      if (actions.onEscapeAll) actions.onEscapeAll();
      return;
    }

    // Ignore single-key shortcuts if typing inside an input/textarea/select
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) {
      return;
    }
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    // Don't fire single-key hotkeys if another modal is open
    const anyModalOpen = [...document.querySelectorAll('.modal')].some(m => !m.classList.contains('hidden'));
    if (anyModalOpen) return;

    const k = e.key.toLowerCase();
    if (e.key === '/') {
      e.preventDefault();
      openSpotlight('');
    } else if (k === 'b') {
      e.preventDefault();
      if (actions.onNewBoard) actions.onNewBoard();
    } else if (k === 's') {
      e.preventDefault();
      if (actions.onStashTabs) actions.onStashTabs();
    } else if (k === 'n') {
      e.preventDefault();
      if (actions.onToggleNotes) actions.onToggleNotes();
    } else if (k === 'p') {
      e.preventDefault();
      if (actions.onToggleBlur) actions.onToggleBlur();
    } else if (k === 't') {
      e.preventDefault();
      if (actions.onTidyUp) actions.onTidyUp();
    }
  });
}

// ─────────────────────────────────────────────
// 6. CANVAS PAN (SPACE + DRAG OR MIDDLE-CLICK DRAG)
// ─────────────────────────────────────────────
export function initCanvasPan(workspace) {
  if (!workspace) return;
  let isSpaceDown = false;
  let isPanning = false;
  let startX = 0, startY = 0, scrollLeft = 0, scrollTop = 0;

  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable) return;
      if (!isSpaceDown) {
        isSpaceDown = true;
        workspace.classList.add('canvas-pan-ready');
      }
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      isSpaceDown = false;
      isPanning = false;
      workspace.classList.remove('canvas-pan-ready', 'canvas-panning');
    }
  });

  workspace.addEventListener('pointerdown', (e) => {
    // Allow middle-click (button 1) OR Space + Left-click (button 0)
    if (e.button === 1 || (isSpaceDown && e.button === 0)) {
      isPanning = true;
      startX = e.clientX;
      startY = e.clientY;
      scrollLeft = workspace.scrollLeft;
      scrollTop = workspace.scrollTop;
      workspace.classList.add('canvas-panning');
      workspace.setPointerCapture(e.pointerId);
      e.preventDefault();
      e.stopPropagation();
    }
  }, { capture: true });

  workspace.addEventListener('pointermove', (e) => {
    if (!isPanning) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    workspace.scrollLeft = scrollLeft - dx;
    workspace.scrollTop = scrollTop - dy;
  });

  const endPan = (e) => {
    if (!isPanning) return;
    isPanning = false;
    workspace.classList.remove('canvas-panning');
    try { workspace.releasePointerCapture(e.pointerId); } catch {}
  };

  workspace.addEventListener('pointerup', endPan);
  workspace.addEventListener('pointercancel', endPan);
}

function _esc(str) {
  return (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


