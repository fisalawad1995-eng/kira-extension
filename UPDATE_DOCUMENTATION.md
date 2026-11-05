# Board Tab (Kira Extension) — Comprehensive Update Documentation

This document provides a complete overview of all the new features, productivity widgets, workflow enhancements, and visual refinements implemented across the extension.

---

## 1. Supercharged Quick Save Popup (`Alt+Shift+S`)

The extension popup has been redesigned into an intelligent bookmarking and session-stashing cockpit.

```
┌────────────────────────────────────────────────────────────┐
│ [Favicon]  [ ✎ Rename: Patient Referral                 ]  │
│            https://his.safeerhospital.com/app/...          │
├────────────────────────────────────────────────────────────┤
│ Save to Board: [ E2NEXT ▾ ]     ✨ Suggested for this site  │
│ Page:          [ General ▾ ]                               │
│                                                            │
│ › Add note & tags                                          │
│ ⚠ Already saved in E2NEXT › General  [Open] [Move here]   │
│                                                            │
│ [x] Close this tab after saving                            │
│ [         Save (Enter)         ]  [     Cancel (Esc)     ] │
├────────────────────────────────────────────────────────────┤
│ ⚡ Stash: [ All tabs in this window ▾ ] [ Stash Button ]   │
│ [x] Close stashed tabs                                     │
└────────────────────────────────────────────────────────────┘
```

### Key Capabilities
- **Inline Bookmark Renaming**:
  - The bookmark title is displayed in a dedicated input box featuring a `✎ Rename` badge.
  - Clicking the title field automatically selects the entire text for instant replacement.
- **Smart Board & Page Memory**:
  - Remembers where you save specific domains. Visiting a site previously saved to a board automatically preselects that board with a `✨ Suggested for [domain]` badge.
  - Automatically falls back to boards containing bookmarks from the same domain, or your most recently used board.
- **Inline Board & Page Creation**:
  - Select `＋ New board…` or `＋ New page…` directly from the dropdowns to create targets without opening the new tab page.
- **Cross-Board Duplicate Detection**:
  - Scans all boards and pages for existing matches of the current URL.
  - Shows where the link already lives and provides a **Move here** button to transfer it instantly.
- **Notes & Tagging**:
  - Expandable **Add note & tags** section supporting notes up to 500 characters and `#tags` (e.g., `#dev #docs`).
  - Tags are indexed in the global search engine and can be queried using `#tag` or keyword search.
- **Declutter Toggle**:
  - Optional `"Close this tab after saving"` checkbox that remembers your preference.
- **Multi-Scope Tab Stashing**:
  - Stash tabs directly from the popup with 4 flexible scope options:
    1. *All tabs in this window*
    2. *Tabs to the right*
    3. *Selected (highlighted) tabs*
    4. *All windows*
  - Automatically filters out internal browser URLs and pinned tabs.
- **Undo Safety Net & Countdown**:
  - Shows a confirmation card with a 3.5-second progress countdown.
  - Provides an **↶ Undo** button (`Ctrl+Z`) that rolls back saved bookmarks, created boards, and prevents tab closure.
- **Keyboard Navigation**:
  - `Enter`: Save
  - `Esc`: Cancel / Close
  - `Alt + ↑ / ↓`: Cycle through boards
  - `Ctrl + Z`: Undo save (during countdown)
  - `Alt + Shift + S`: Global browser hotkey to trigger the popup on any tab

---

## 2. In-Place Bookmark Renaming Across All Boards

Any bookmark saved on the new tab page can now be edited on the fly without deleting and recreating it.

- **Hover `✎` Button**: Hovering over any bookmark item reveals a rename button beside the delete icon.
- **Double-Click to Edit**: Double-clicking a bookmark title directly transforms the label into an inline text input.
- **Right-Click Context Menu**: Right-clicking any bookmark row provides a `✎ Rename` option.
- **Universal Support**: Works seamlessly on both **Custom Boards** (stored in IndexedDB) and **Native Chrome Bookmark Folders** (synced via `chrome.bookmarks.update`).
- **Live Search Index Synchronization**: Editing a bookmark immediately updates the in-memory fuzzy search index.

---

## 3. Productivity & Ambient Widgets

Three ambient widgets integrated directly into the workspace top bar and canvas:

### Ambient Clock & Date Pill
- Displays live 12-hour time, AM/PM, day of the week, and date in a single compact pill.
- Smooth real-time updates synchronized to the second.

### Live Weather Badge
- Powered by the Open-Meteo API (zero API key configuration required).
- Fetches real-time temperature (°C), current conditions (sunny, partly cloudy, rain, etc.), and localized city name using browser geolocation.
- Automatically cached to prevent unnecessary network requests.

### Draggable Floating Scratchpad & Daily Tasks
- **Quick Notes Tab**:
  - Auto-saving markdown/plain text area with live character and word counters.
  - Quick **Copy All** and **Clear** actions.
- **Daily Tasks Tab**:
  - Interactive to-do list with item checkboxes, strike-through styling, and deletion.
- **Floating Controls**:
  - Fully draggable header to position the widget anywhere on screen.
  - State persisted across sessions.

---

## 4. Universal Spotlight Command Palette (`Ctrl+K` or `/`)

A centralized search and command runner for high-velocity navigation.

- **Fast Bookmark Search**: Fuzzy title, URL, breadcrumb, and `#tag` search across all boards.
- **Board Quick-Jump**: Type `#<board-name>` to jump directly to any board on the canvas with an animated pulse highlight.
- **Action Commands**: Prefix with `>` to run workspace commands:
  - `>Toggle Light / Dark Theme`
  - `>Switch to Free Canvas / Grid Layout`
  - `>Open Scratchpad`
  - `>Stash Open Tabs`
  - `>Import Bookmarks` / `>Export Backup`
- **Global Single-Key Shortcuts**:
  - `B`: Add Board
  - `S`: Open Settings
  - `N`: Add Link
  - `P`: Toggle Pan Mode
  - `T`: Open Trash Panel
  - `Esc`: Close any active modal or menu

---

## 5. Tab Management & Bulk Actions

- **Stash All Tabs Modal**:
  - Accessible via the `#btn-stash-tabs` button in the top bar.
  - Review all open tabs with checkboxes to select/deselect specific tabs before stashing.
  - Automatically packages selected tabs into a new dated board (e.g., `Session — Nov 5, 12:00 PM`) or merges into an existing board.
  - Optional declutter checkbox to close saved tabs immediately.
- **One-Click "Open All"**:
  - Header button on each board column to open all links in that board's active page simultaneously.
  - `Shift + Click` opens all links in a clean, dedicated browser window.
- **Drag-and-Drop Ingestion**:
  - Drag links or URLs directly from other browser windows or external applications straight onto a board column to add them instantly.

---

## 6. Canvas Mechanics & Visual Polish

- **✨ Tidy Up Canvas**:
  - Automatically re-organizes scattered boards on the infinite canvas into clean, aligned rows and columns.
- **Board Color Accents**:
  - Assign custom color accents per board or folder from the right-click menu swatches.
  - Dynamically shades board headers, active tab pills, and column borders.
- **Infinite Canvas Pan**:
  - Hold `Space + Left Click Drag` or use `Middle-Click Drag` to smoothly pan across the workspace.
  - Drag navigation indicators.
- **Monogram Favicon Generator**:
  - Automatically generates colorful SVG letter monograms for bookmarks without high-resolution favicons.

---

## 7. Light & Dark Mode Overhaul

- **Light Mode Contrast**:
  - Completely retuned Light Mode design tokens (`--bg-body`, `--bg-column`, `--text-primary`, `--surface-hover`, `--column-shadow`).
  - Radio buttons, toggle switches, swatches, and modals now feature high-contrast outlines and visible hover states.
- **Wallpaper Clarity**:
  - Eliminated the white gradient haze on Light Mode (`body[data-theme="light"]::before`), allowing background wallpapers to display at full clarity.
- **Theme Switcher Synchronization**:
  - Settings sidebar controls and Spotlight commands stay in sync regardless of how the theme is toggled.

---

## 8. Summary of Files Changed

| File | Purpose |
| :--- | :--- |
| `popup/quick-save-picker.html` | Markup and styling for the redesigned Quick Save popup |
| `popup/popup.js` | Logic for smart suggestions, inline rename, duplicate detection, tags, stashing, and undo |
| `modules/boards.js` | In-place bookmark renaming (`✎` hover, double-click, context menu) for custom & native boards |
| `modules/widgets.js` | Clock, Weather badge, Scratchpad, To-Do list, Spotlight palette, and Tidy Up Canvas |
| `modules/theme.js` | Light/Dark tokens, accent colors, and wallpaper contrast handling |
| `modules/search.js` | Tag search (`#tag`) and real-time index updates |
| `newtab/app.js` | Wiring for rename callbacks, widget initialization, and canvas panning |
| `newtab/styles/main.css` | Styling for bookmark rename inputs, widgets, modals, and Light Mode overrides |
| `manifest.json` | Registered `Alt+Shift+S` action shortcut and background permissions |

