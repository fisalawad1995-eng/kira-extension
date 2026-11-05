// Board Tab — Smart Search Module
// Builds an in-memory index; zero IndexedDB reads per keystroke.

let _searchIndex = []; // flat array of indexable entries

// ─────────────────────────────────────────────
// Build / refresh index
// ─────────────────────────────────────────────

/**
 * Rebuild the full search index from active bookmarks.
 * Call after any data change that could affect search results.
 * @param {Array} bookmarks - all active (non-trashed) bookmark objects
 * @param {Object} pageMap  - { [page_id]: { title, board_id } }
 * @param {Object} boardMap - { [board_id]: { title } }
 */
export function buildSearchIndex(items) {
  _searchIndex = (items || []).map(bk => ({
    id: bk.id,
    page_id: bk.page_id,
    board_id: bk.board_id || '',
    title_lower: (bk.title || '').toLowerCase(),
    url_lower: (bk.url || '').toLowerCase(),
    tags_lower: (bk.tags || []).join(' ').toLowerCase(),
    page_title_lower: (bk.page_title || '').toLowerCase(),
    board_title_lower: (bk.board_title || '').toLowerCase(),
    // original refs for display
    title: bk.title,
    url: bk.url,
    favicon: bk.favicon || '',
    page_title: bk.page_title || 'Page',
    board_title: bk.board_title || 'Board',
    tags: bk.tags || []
  }));
}

/**
 * Search the in-memory index. Pure function — no async.
 * @param {string} query
 * @param {{ scope: 'all'|'board', boardId?: string, exact: boolean }} opts
 * @returns {Array} ranked results sorted by score descending
 */
export function search(query, opts = {}) {
  if (!query || !query.trim()) return [];

  const q = query.trim().toLowerCase().replace(/(^|\s)#+(?=\S)/g, '$1');
  if (!q) return [];
  const { scope = 'all', boardId = null, exact = false } = opts;

  const entries = scope === 'board' && boardId
    ? _searchIndex.filter(e => e.board_id === boardId)
    : _searchIndex;

  const results = [];

  for (const entry of entries) {
    const score = _scoreEntry(entry, q, exact);
    if (score > 0) results.push({ ...entry, _score: score });
  }

  results.sort((a, b) => b._score - a._score);
  return results;
}

function _scoreEntry(entry, q, exact) {
  let score = 0;

  if (exact) {
    // literal substring match, case-insensitive
    if (entry.title_lower.includes(q)) score += 3;
    if (entry.tags_lower.includes(q)) score += 2;
    if (entry.url_lower.includes(q)) score += 1;
  } else {
    // token-overlap fuzzy: every query token must appear somewhere
    const tokens = q.split(/\s+/).filter(Boolean);

    const titleMatches = tokens.filter(t => entry.title_lower.includes(t)).length;
    const tagMatches = tokens.filter(t => entry.tags_lower.includes(t)).length;
    const urlMatches = tokens.filter(t => entry.url_lower.includes(t)).length;

    if (titleMatches === tokens.length) score += 3 * titleMatches;
    else if (titleMatches > 0) score += titleMatches;

    if (tagMatches === tokens.length) score += 2 * tagMatches;
    else if (tagMatches > 0) score += tagMatches;

    if (urlMatches === tokens.length) score += urlMatches;
  }

  return score;
}

/**
 * Returns current index size (useful for dev/debug)
 */
export function indexSize() {
  return _searchIndex.length;
}
