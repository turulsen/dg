/* ══════════════════════════════════════════════
   PLAYER NOTES -- v1: shared/private block notes scoped to a Cell.

   Built as a self-mounting module (window.dgNotesPanel.init(el, opts))
   rather than a page-specific script, on purpose: v1 mounts it into
   notes/index.html's own standalone shell, but a later phase mounts
   the exact same module into a side panel on stats/index.html during
   Live Play -- that phase becomes "add a container + call init()",
   not a rewrite, as long as this file never assumes it owns the whole
   page.

   opts = {
     cellId: string,
     agentCode: string,        -- the viewer's own Agent Code (identity)
     memberCodes: string[],    -- every Agent Code in this Cell
     memberNames: {code: name} -- optional, for nicer tab labels
   }

   Every CSS class here is authored under the #dg-notes-panel prefix
   (see notes.css) so this survives being dropped onto a themed page
   later without a retrofit -- same defensive-specificity trick
   assets/table-radio.js already uses for the exact same reason.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
  const POLL_MS = 5000; // slower than Table Radio's 2s -- note content changes far less often than "what's playing"
  const SAVE_DEBOUNCE_MS = 1200; // matches agent-hub.html's scheduleNoteSave() convention

  const BLOCK_TYPES = [
    { id: 'heading', label: 'Heading' },
    { id: 'paragraph', label: 'Paragraph' },
    { id: 'bullet', label: 'Bullet' },
  ];

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Same "remove the previous cycle's leftover script tag, then inject a
  // fresh one" JSONP convention used by table-radio.js's polling and
  // agent-hub.html's jsonpGet() -- a 6s client-side timeout no-ops a
  // late response rather than leaving a stale callback on window forever.
  function jsonpGet(action, params, cb) {
    const cbName = '_dgNotes_' + action + '_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const prevScript = document.getElementById('_dg_notes_jsonp_script');
    if (prevScript) prevScript.remove();
    // Generous on purpose, well beyond POLL_MS: a tight timeout here
    // raced a real (if slow) response under load during testing -- the
    // timeout fired and deleted window[cbName] first, then the response
    // that was already in flight arrived and tried to call the
    // now-deleted callback, throwing a ReferenceError. This only needs
    // to catch a genuinely hung/dead request, not bound normal latency.
    const timer = setTimeout(() => { delete window[cbName]; cb(null); }, 20000);
    window[cbName] = function (res) {
      clearTimeout(timer);
      delete window[cbName];
      cb(res);
    };
    const s = document.createElement('script');
    s.id = '_dg_notes_jsonp_script';
    let qs = 'action=' + action + '&callback=' + cbName;
    Object.keys(params || {}).forEach(k => { qs += '&' + k + '=' + encodeURIComponent(params[k]); });
    s.src = APPS_SCRIPT_URL + '?' + qs;
    document.head.appendChild(s);
  }

  // Fire-and-forget, no read-back -- same weight as saveHandoutNote()'s
  // "low-stakes personal scratchpad" write, not the heavier verified-write
  // pattern used for shared campaign state elsewhere in this app.
  function postAction(payload) {
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
  }

  // Mints the block's real, permanent id up front, in the same shape
  // the backend itself mints one server-side (see saveNoteBlock() in
  // Code.gs). Sending this on the very first save means the backend
  // uses it as the new row's id instead of minting its own -- so a
  // poll landing before that write is confirmed (no-cors hides the
  // POST's own response) echoes back the exact id already on screen,
  // rather than a second, server-only id the client would never learn.
  function mintBlockId() {
    return 'block_' + Date.now() + '_' + Math.floor(Math.random() * 1e5).toString(36);
  }

  function init(container, opts) {
    opts = opts || {};
    const cellId = opts.cellId;
    const agentCode = (opts.agentCode || '').trim().toUpperCase();
    const memberCodes = (opts.memberCodes || []).slice();
    if (memberCodes.indexOf(agentCode) === -1) memberCodes.unshift(agentCode);
    const memberNames = opts.memberNames || {};

    let notesByCode = {}; // agent_code -> [{block_id, block_type, text, shared, sort_order, updated_at}]
    let activeCode = agentCode;
    let searchTerm = '';
    let pollTimer = null;
    // A poll's own render() does a full innerHTML rebuild -- doing that
    // while a field has focus destroys and recreates that DOM node,
    // which drops focus (and with it, on mobile, the keyboard) even
    // though the block's own text is fine. A real report: "every 2-3
    // seconds my keyboard disappears, or the text disappears or
    // reappears" -- that's this, landing right on POLL_MS's cadence.
    // Deferred instead of dropped: the poll's data still updates
    // notesByCode normally, just the re-render waits for the field to
    // blur, so nothing you're actively typing ever gets interrupted.
    let deferredRenderPending = false;
    const saveTimers = {}; // block_id -> setTimeout handle
    // A no-cors POST's own response can't be read, so there's no way to
    // know a save/delete has actually landed except by seeing it (or
    // its absence) reflected in a later poll. touchedAt bridges that
    // gap: a block edited/added in roughly the last poll interval is
    // kept exactly as shown locally rather than reset to whatever
    // list_cell_notes returns, so a poll landing mid-edit (or between
    // "you typed a new note" and the write actually landing) can't
    // make it flicker away out from under you.
    const touchedAt = {}; // block_id -> Date.now() of the last local edit
    const RECENT_TOUCH_MS = POLL_MS + 2000;

    function memberLabel(code) {
      return memberNames[code] ? memberNames[code] + ' (' + code + ')' : code;
    }

    function isTypingInField() {
      const el = document.activeElement;
      return !!(el && container.contains(el) && el.classList &&
        (el.classList.contains('dg-notes-block-text') || el.classList.contains('dg-notes-search')));
    }

    // Only the poll's own render should ever be deferred -- a user-driven
    // render (adding/deleting a block, switching tabs, searching) should
    // always happen immediately, since those are the user's own action
    // and typically re-focus something right after anyway.
    function renderFromPoll() {
      if (isTypingInField()) {
        deferredRenderPending = true;
        return;
      }
      render();
    }

    function allVisibleBlocks() {
      const out = [];
      Object.keys(notesByCode).forEach(code => {
        (notesByCode[code] || []).forEach(b => out.push(Object.assign({ owner: code }, b)));
      });
      return out;
    }

    function matchesSearch(block) {
      if (!searchTerm) return true;
      const t = searchTerm.toLowerCase();
      return (block.text || '').toLowerCase().includes(t);
    }

    function render() {
      const tabsHtml = memberCodes.map(code => {
        const cls = code === activeCode ? 'dg-notes-tab active' : 'dg-notes-tab';
        return `<button type="button" class="${cls}" data-tab="${escapeHtml(code)}">${escapeHtml(memberLabel(code))}</button>`;
      }).join('');

      const tocBlocks = allVisibleBlocks()
        .filter(b => b.block_type === 'heading')
        .sort((a, b) => a.sort_order - b.sort_order);
      const tocHtml = tocBlocks.length
        ? tocBlocks.map(b => `<a href="#" class="dg-notes-toc-item" data-scroll-to="${escapeHtml(b.block_id)}">${escapeHtml(b.text || '(untitled)')}</a>`).join('')
        : '<div class="dg-notes-toc-empty">No headings yet.</div>';

      const activeBlocks = (notesByCode[activeCode] || []).slice().sort((a, b) => a.sort_order - b.sort_order);
      const isOwnTab = activeCode === agentCode;
      const visibleBlocks = activeBlocks.filter(matchesSearch);
      const blocksHtml = visibleBlocks.length
        ? visibleBlocks.map(b => renderBlock(b, isOwnTab)).join('')
        : `<div class="dg-notes-empty">${searchTerm ? 'No blocks match your search.' : (isOwnTab ? 'Nothing here yet -- add a block below.' : 'Nothing shared here yet.')}</div>`;

      container.innerHTML = `
        <div id="dg-notes-panel">
          <div class="dg-notes-toolbar">
            <input type="search" class="dg-notes-search" placeholder="Search notes…" value="${escapeHtml(searchTerm)}">
          </div>
          <div class="dg-notes-body">
            <aside class="dg-notes-toc">
              <div class="dg-notes-toc-label">Index</div>
              ${tocHtml}
            </aside>
            <main class="dg-notes-main">
              <div class="dg-notes-tabs">${tabsHtml}</div>
              <div class="dg-notes-blocks">${blocksHtml}</div>
              ${isOwnTab ? renderAddRow() : ''}
            </main>
          </div>
        </div>`;

      wireEvents();
    }

    function renderBlock(b, isOwnTab) {
      const typeCls = 'dg-notes-block dg-notes-block-' + b.block_type;
      const tag = b.block_type === 'paragraph' || b.block_type === 'bullet' ? 'textarea' : 'input';
      const field = tag === 'textarea'
        ? `<textarea class="dg-notes-block-text" data-block-id="${escapeHtml(b.block_id)}" rows="2" ${isOwnTab ? '' : 'readonly'}>${escapeHtml(b.text)}</textarea>`
        : `<input type="text" class="dg-notes-block-text" data-block-id="${escapeHtml(b.block_id)}" value="${escapeHtml(b.text)}" ${isOwnTab ? '' : 'readonly'}>`;
      const controls = isOwnTab ? `
        <label class="dg-notes-shared-toggle">
          <input type="checkbox" data-shared-toggle="${escapeHtml(b.block_id)}" ${b.shared ? 'checked' : ''}>
          Shared
        </label>
        <button type="button" class="dg-notes-block-del" data-delete="${escapeHtml(b.block_id)}" title="Delete block">&times;</button>
      ` : `<span class="dg-notes-shared-badge">${b.shared ? 'Shared' : 'Private'}</span>`;
      return `<div class="${typeCls}" id="block-${escapeHtml(b.block_id)}" data-block-id="${escapeHtml(b.block_id)}">
        <div class="dg-notes-block-field">${field}</div>
        <div class="dg-notes-block-controls">${controls}</div>
      </div>`;
    }

    function renderAddRow() {
      return `<div class="dg-notes-add-row">
        ${BLOCK_TYPES.map(t => `<button type="button" class="dg-notes-add-btn" data-add-type="${t.id}">+ ${t.label}</button>`).join('')}
      </div>`;
    }

    function wireEvents() {
      container.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => { activeCode = btn.dataset.tab; render(); });
      });
      const search = container.querySelector('.dg-notes-search');
      if (search) {
        search.addEventListener('input', () => { searchTerm = search.value; render(); search.focus(); search.selectionStart = search.selectionEnd = search.value.length; });
        search.addEventListener('blur', () => {
          if (deferredRenderPending) { deferredRenderPending = false; render(); }
        });
      }
      container.querySelectorAll('[data-scroll-to]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          const owner = Object.keys(notesByCode).find(code => (notesByCode[code] || []).some(b => b.block_id === a.dataset.scrollTo));
          if (owner && owner !== activeCode) { activeCode = owner; render(); }
          requestAnimationFrame(() => {
            const el = document.getElementById('block-' + a.dataset.scrollTo);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
      });
      container.querySelectorAll('.dg-notes-block-text').forEach(field => {
        field.addEventListener('input', () => scheduleSave(field.dataset.blockId));
        field.addEventListener('blur', () => {
          if (deferredRenderPending) { deferredRenderPending = false; render(); }
        });
      });
      container.querySelectorAll('[data-shared-toggle]').forEach(cb => {
        cb.addEventListener('change', () => scheduleSave(cb.dataset.sharedToggle, { immediate: true }));
      });
      container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteBlock(btn.dataset.delete));
      });
      container.querySelectorAll('[data-add-type]').forEach(btn => {
        btn.addEventListener('click', () => addBlock(btn.dataset.addType));
      });
    }

    function findBlock(blockId) {
      const list = notesByCode[activeCode] || [];
      return list.find(b => b.block_id === blockId);
    }

    function scheduleSave(blockId, opts2) {
      const block = findBlock(blockId);
      if (!block) return;
      const fieldEl = container.querySelector('[data-block-id="' + blockId + '"].dg-notes-block-text');
      if (fieldEl) block.text = fieldEl.value;
      const toggleEl = container.querySelector('[data-shared-toggle="' + blockId + '"]');
      if (toggleEl) block.shared = toggleEl.checked;
      block.updated_at = Date.now();
      touchedAt[blockId] = Date.now();
      clearTimeout(saveTimers[blockId]);
      const delay = (opts2 && opts2.immediate) ? 0 : SAVE_DEBOUNCE_MS;
      saveTimers[blockId] = setTimeout(() => saveBlock(block), delay);
    }

    function saveBlock(block) {
      touchedAt[block.block_id] = Date.now();
      postAction({
        action: 'save_note_block',
        block_id: block.block_id,
        cell_id: cellId,
        agent_code: agentCode,
        block_type: block.block_type,
        text: block.text,
        shared: !!block.shared,
        sort_order: block.sort_order,
      }).catch(() => { /* best-effort, matches saveHandoutNote()'s weight */ });
    }

    function addBlock(blockType) {
      const list = notesByCode[agentCode] || (notesByCode[agentCode] = []);
      const maxSort = list.reduce((m, b) => Math.max(m, b.sort_order), 0);
      const block = {
        block_id: mintBlockId(), block_type: blockType, text: '', shared: false,
        sort_order: maxSort + 1000, updated_at: Date.now(),
      };
      list.push(block);
      activeCode = agentCode;
      render();
      const fieldEl = container.querySelector('[data-block-id="' + block.block_id + '"].dg-notes-block-text');
      if (fieldEl) fieldEl.focus();
      saveBlock(block);
    }

    function deleteBlock(blockId) {
      const list = notesByCode[agentCode] || [];
      const idx = list.findIndex(b => b.block_id === blockId);
      if (idx === -1) return;
      list.splice(idx, 1);
      delete touchedAt[blockId];
      render();
      postAction({ action: 'delete_note_block', block_id: blockId, cell_id: cellId }).catch(() => { });
    }

    function fetchNotes() {
      if (!cellId) return;
      jsonpGet('list_cell_notes', { cell_id: cellId, agent_code: agentCode }, res => {
        if (!res || res.status !== 'OK') return;
        const incoming = res.notes || {};
        const incomingOwn = incoming[agentCode] || [];
        const incomingOwnIds = new Set(incomingOwn.map(b => b.block_id));
        const localOwn = notesByCode[agentCode] || [];
        const now = Date.now();
        const stillPending = localOwn.filter(b =>
          !incomingOwnIds.has(b.block_id) && touchedAt[b.block_id] && (now - touchedAt[b.block_id]) < RECENT_TOUCH_MS);
        incoming[agentCode] = incomingOwn.concat(stillPending);
        notesByCode = incoming;
        renderFromPoll();
      });
    }

    function startPolling() {
      stopPolling();
      pollTimer = setInterval(fetchNotes, POLL_MS);
    }
    function stopPolling() {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = null;
    }

    render();
    fetchNotes();
    startPolling();

    return { refresh: fetchNotes, destroy: stopPolling };
  }

  window.dgNotesPanel = { init };
})();
