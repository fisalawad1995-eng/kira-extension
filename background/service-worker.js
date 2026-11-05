// Board Tab — Service Worker (MV3)
// Handles: Quick Save shortcut, context menu registration, message routing.

// ─────────────────────────────────────────────
// Install — register context menus
// ─────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'bt-open-incognito',
    title: 'Open in Incognito',
    contexts: ['link', 'page']
  });

  chrome.contextMenus.create({
    id: 'bt-quick-save-page',
    title: 'Quick Save to Board Tab',
    contexts: ['page', 'frame']
  });
});

// ─────────────────────────────────────────────
// Context menu clicks
// ─────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'bt-open-incognito') {
    const url = info.linkUrl || info.pageUrl;
    if (url) chrome.windows.create({ url, incognito: true });
  }

  if (info.menuItemId === 'bt-quick-save-page') {
    _dispatchQuickSave(tab);
  }
});

// ─────────────────────────────────────────────
// Keyboard shortcut
// ─────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === 'quick-save') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) _dispatchQuickSave(tabs[0]);
    });
  }
});

// ─────────────────────────────────────────────
// Quick Save dispatch
// Try to message the new tab page; if not open, open popup window.
// ─────────────────────────────────────────────
function _dispatchQuickSave(tab) {
  const payload = {
    type: 'QUICK_SAVE',
    tab: {
      title: tab.title,
      url: tab.url,
      favIconUrl: tab.favIconUrl || ''
    }
  };

  // Find any open new tab page
  chrome.tabs.query({ url: chrome.runtime.getURL('newtab/index.html') }, (ntTabs) => {
    if (ntTabs && ntTabs.length > 0) {
      chrome.tabs.sendMessage(ntTabs[0].id, payload);
    } else {
      // Open popup window with the quick save picker
      const w = 360;
      const h = 480;
      chrome.windows.create({
        url: chrome.runtime.getURL('popup/quick-save-picker.html') +
             '?title=' + encodeURIComponent(payload.tab.title) +
             '&url='   + encodeURIComponent(payload.tab.url) +
             '&fav='   + encodeURIComponent(payload.tab.favIconUrl) +
             (tab.id != null ? '&tabId=' + tab.id : ''),
        type: 'popup',
        width: w + 40,
        height: h + 160
      });
    }
  });
}

// Keep service worker alive during Quick Save (MV3 best practice)
chrome.runtime.onMessage.addListener((_msg, _sender, sendResponse) => {
  sendResponse({});
  return true;
});
