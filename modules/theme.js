// Board Tab — Theme Module
// Manages global wallpaper, per-board wallpaper, accent colour, and light/dark mode.
// All persistence goes through DB.settings and DB.boards.

import { DB } from '../db/indexeddb.js';

const ROOT = document.documentElement;

// ─────────────────────────────────────────────
// Token setters
// ─────────────────────────────────────────────
function _setToken(name, value) {
  ROOT.style.setProperty(name, value);
}

// ─────────────────────────────────────────────
// Load & apply all persisted theme settings
// ─────────────────────────────────────────────
export async function applyPersistedTheme() {
  const settings = await DB.settings.getAll();

  // Mode (dark is default)
  const mode = settings.theme_mode || 'dark';
  applyMode(mode, false);

  // Accent colour
  const accent = settings.theme_accent || '#8B5CF6';
  applyAccent(accent, false);

  // Global wallpaper
  const wallpaper = settings.global_wallpaper || null;
  applyGlobalWallpaper(wallpaper, false);
}

// ─────────────────────────────────────────────
// Mode
// ─────────────────────────────────────────────
export async function applyMode(mode, persist = true) {
  document.body.dataset.theme = mode;
  document.querySelectorAll('.style-toggle').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode === 'light') {
    _setToken('--bg-body', '#f4f2ee');
    _setToken('--bg-column', 'rgba(255, 255, 255, 0.86)');
    _setToken('--bg-column-hover', 'rgba(255, 255, 255, 0.94)');
    _setToken('--text-primary', '#18181b');
    _setToken('--text-secondary', 'rgba(24, 24, 27, 0.65)');
    _setToken('--border-subtle', 'rgba(0, 0, 0, 0.09)');
    _setToken('--context-menu-bg', 'rgba(255, 255, 255, 0.96)');
    _setToken('--modal-bg', '#ffffff');
    _setToken('--settings-bg', 'rgba(248, 247, 252, 0.96)');
    _setToken('--bg-panel', 'rgba(255, 255, 255, 0.92)');
    _setToken('--input-bg', '#f4f3f8');
    _setToken('--input-border', 'rgba(0, 0, 0, 0.15)');
    _setToken('--btn-bg', 'rgba(255, 255, 255, 0.86)');
    _setToken('--btn-hover-bg', 'rgba(255, 255, 255, 0.98)');
    _setToken('--surface-hover', 'rgba(0, 0, 0, 0.06)');
    _setToken('--surface-subtle', 'rgba(0, 0, 0, 0.04)');
    _setToken('--column-shadow', '0 10px 30px rgba(0, 0, 0, 0.15)');
    _setToken('--overlay-gradient', 'none');
  } else {
    _setToken('--bg-body', '#110e14');
    _setToken('--bg-column', 'rgba(28, 18, 14, 0.45)');
    _setToken('--bg-column-hover', 'rgba(40, 25, 18, 0.6)');
    _setToken('--text-primary', '#ffffff');
    _setToken('--text-secondary', 'rgba(255, 255, 255, 0.65)');
    _setToken('--border-subtle', 'rgba(255, 255, 255, 0.07)');
    _setToken('--context-menu-bg', '#231b2b');
    _setToken('--modal-bg', '#1b1423');
    _setToken('--settings-bg', '#1c1524');
    _setToken('--bg-panel', 'rgba(28, 21, 36, 0.9)');
    _setToken('--input-bg', '#110c16');
    _setToken('--input-border', '#48345c');
    _setToken('--btn-bg', 'rgba(45, 32, 25, 0.75)');
    _setToken('--btn-hover-bg', 'rgba(90, 65, 50, 0.9)');
    _setToken('--surface-hover', 'rgba(255, 255, 255, 0.07)');
    _setToken('--surface-subtle', 'rgba(255, 255, 255, 0.04)');
    _setToken('--column-shadow', '0 10px 30px rgba(0, 0, 0, 0.5)');
    _setToken('--overlay-gradient', 'radial-gradient(circle at 80% 50%, rgba(243, 114, 44, 0.15) 0%, rgba(0, 0, 0, 0.55) 80%)');
  }
  if (persist) await DB.settings.set('theme_mode', mode);
}

// ─────────────────────────────────────────────
// Accent colour
// ─────────────────────────────────────────────
export async function applyAccent(hex, persist = true) {
  _setToken('--color-accent', hex);
  // Derive a subtle glow variant
  _setToken('--color-accent-glow', hex + '33');
  if (persist) await DB.settings.set('theme_accent', hex);
}

// ─────────────────────────────────────────────
// Global wallpaper
// ─────────────────────────────────────────────
export async function applyGlobalWallpaper(dataUrlOrNull, persist = true) {
  if (dataUrlOrNull) {
    document.body.style.backgroundImage = `url('${dataUrlOrNull}')`;
  } else {
    document.body.style.backgroundImage =
      "url('https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=1920&q=80')";
  }
  if (persist) await DB.settings.set('global_wallpaper', dataUrlOrNull);
}

// ─────────────────────────────────────────────
// Per-board wallpaper
// ─────────────────────────────────────────────
export async function applyBoardWallpaper(boardId, dataUrlOrNull, persist = true) {
  const colEl = document.querySelector(`[data-board-id="${boardId}"]`);
  if (colEl) {
    if (dataUrlOrNull) {
      colEl.style.backgroundImage = `url('${dataUrlOrNull}')`;
      colEl.style.backgroundSize = 'cover';
      colEl.style.backgroundPosition = 'center';
      colEl.classList.add('has-board-wallpaper');
    } else {
      colEl.style.backgroundImage = '';
      colEl.classList.remove('has-board-wallpaper');
    }
  }
  if (persist) {
    const board = await DB.boards.get(boardId);
    if (board) {
      board.wallpaper_ref = dataUrlOrNull;
      await DB.boards.save(board);
    }
  }
}

// Re-apply per-board wallpapers after re-render
export async function applyAllBoardWallpapers() {
  const boards = await DB.boards.getAll();
  for (const board of boards) {
    if (board.wallpaper_ref) {
      await applyBoardWallpaper(board.id, board.wallpaper_ref, false);
    }
  }
}

// ─────────────────────────────────────────────
// Saved Wallpapers Gallery Manager
// ─────────────────────────────────────────────
export async function getSavedWallpapers() {
  return (await DB.settings.get('saved_wallpapers')) || [];
}

export async function addSavedWallpaper(dataUrl, name = 'Wallpaper') {
  const wallpapers = await getSavedWallpapers();
  const wp = {
    id: 'wp_' + crypto.randomUUID(),
    name: name || `Wallpaper ${wallpapers.length + 1}`,
    dataUrl,
    createdAt: Date.now()
  };
  wallpapers.unshift(wp);
  await DB.settings.set('saved_wallpapers', wallpapers);
  return wp;
}

export async function deleteSavedWallpaper(id) {
  const wallpapers = await getSavedWallpapers();
  const filtered = wallpapers.filter(w => w.id !== id);
  await DB.settings.set('saved_wallpapers', filtered);
}
