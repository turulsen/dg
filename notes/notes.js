/* ══════════════════════════════════════════════
   PLAYER NOTES -- shared/private block notes scoped to a Cell, plus a
   combined Shared tab any Cell member can contribute to directly.

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
  const SHARED_TAB = '__shared__'; // pseudo agent_code, never a real one -- selects the combined tab

  const BLOCK_TYPES = [
    { id: 'h1', label: 'H1' },
    { id: 'h2', label: 'H2' },
    { id: 'paragraph', label: 'Text' },
    { id: 'bullet', label: 'Bullet' },
    { id: 'numbered', label: 'Numbered' },
    { id: 'divider', label: 'Divider' },
  ];
  // v1 shipped a single generic 'heading' type before H1/H2 existed --
  // treat any block still carrying that old value as an H1 rather than
  // requiring a data migration.
  function normalizedType(t) { return t === 'heading' ? 'h1' : t; }
  function isHeadingType(t) { const n = normalizedType(t); return n === 'h1' || n === 'h2'; }

  // Each Agent picks one of these once -- their "ink" -- to mark their
  // contributions in the combined Shared tab. Picked for legibility on
  // both light paper and as a left-edge accent bar, not matched to any
  // existing semantic color in this app (--red etc.) since this is a
  // pure identity marker, not a status.
  const AGENT_COLORS = ['#2b6cb0', '#2f855a', '#b7791f', '#805ad5', '#c53030', '#d53f8c', '#2c7a7b', '#4a5568'];
  const AGENT_FONTS = [
    { id: 'caveat', label: 'Caveat', family: "'Caveat', cursive" },
    { id: 'kalam', label: 'Kalam', family: "'Kalam', cursive" },
    { id: 'patrick', label: 'Patrick Hand', family: "'Patrick Hand', cursive" },
  ];
  function fontFamilyFor(fontId) {
    const f = AGENT_FONTS.find(x => x.id === fontId);
    return f ? f.family : 'inherit';
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // A deliberately small, custom syntax -- not full Markdown -- typed
  // directly into the plain <textarea>/<input> editing surface (kept
  // as plain text fields on purpose: contenteditable's mobile Safari
  // quirks are exactly the class of bug that just broke typing here
  // once already). Rendered to HTML only once a block leaves edit mode
  // (see editingBlockId), so what you type is what you see while
  // actively writing, and it "settles into ink" once you look away.
  // Escaped first, so the formatting markers themselves can't be used
  // to inject markup; the color value is restricted to hex/word chars
  // by its own capture group, so it can't break out of the style attr.
  function renderInline(text) {
    let html = escapeHtml(text);
    html = html.replace(/\{color:([#a-zA-Z0-9]+)\}([\s\S]*?)\{\/color\}/g, (m, c, inner) => '<span style="color:' + c + '">' + inner + '</span>');
    html = html.replace(/==([^=]+)==/g, '<mark>$1</mark>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    html = html.replace(/_([^_]+)_/g, '<i>$1</i>');
    return html;
  }

  // Same "remove the previous cycle's leftover script tag, then inject a
  // fresh one" JSONP convention used by table-radio.js's polling and
  // agent-hub.html's jsonpGet().
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
    const IDENTITY_KEY = 'dg_notes_identity_' + agentCode;

    let notesByCode = {}; // agent_code -> [{block_id, block_type, text, shared, sort_order, created_at, updated_at}]
    let identities = {}; // agent_code -> {color, font}, from the server
    let myIdentity = null; // {color, font} once known or chosen
    let identityPromptShown = false;
    let activeCode = agentCode; // an Agent Code, or SHARED_TAB
    let searchTerm = '';
    let pollTimer = null;
    let editingBlockId = null; // the one block currently swapped into its raw-text edit field, or null
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

    function identityFor(code) {
      if (code === agentCode && myIdentity) return myIdentity;
      return identities[code] || null;
    }

    /* ── Identity: pick once, remembered per Agent Code both locally and
       server-side (so it follows the same Agent to another device). ── */
    function loadLocalIdentity() {
      try { return JSON.parse(localStorage.getItem(IDENTITY_KEY) || 'null'); } catch (e) { return null; }
    }
    function saveLocalIdentity(id) {
      try { localStorage.setItem(IDENTITY_KEY, JSON.stringify(id)); } catch (e) { /* best effort */ }
    }

    function ensureIdentity() {
      if (myIdentity) return;
      const local = loadLocalIdentity();
      if (local && local.color) { myIdentity = local; return; }
      if (identities[agentCode] && identities[agentCode].color) {
        myIdentity = identities[agentCode];
        saveLocalIdentity(myIdentity);
        return;
      }
      if (!identityPromptShown) {
        identityPromptShown = true;
        showIdentityPicker();
      }
    }

    // Appended to document.body (not `container`) and removed
    // explicitly on confirm -- render() replaces container's entire
    // innerHTML on every poll, which would otherwise wipe this out
    // mid-choice.
    function showIdentityPicker() {
      const modal = document.createElement('div');
      modal.className = 'dg-notes-identity-modal';
      modal.innerHTML =
        '<div class="dg-notes-identity-card">' +
        '<div class="dg-notes-identity-title">Pick your ink</div>' +
        '<p class="dg-notes-identity-sub">Your color and handwriting mark your own contributions in the Shared notebook, for every Cell member to see.</p>' +
        '<div class="dg-notes-identity-colors">' +
        AGENT_COLORS.map(c => '<button type="button" class="dg-notes-color-swatch" data-color="' + c + '" style="background:' + c + '" aria-label="' + c + '"></button>').join('') +
        '</div>' +
        '<div class="dg-notes-identity-fonts">' +
        AGENT_FONTS.map((f, i) => '<button type="button" class="dg-notes-font-choice' + (i === 0 ? ' selected' : '') + '" data-font="' + f.id + '" style="font-family:' + f.family + '">' + f.label + '</button>').join('') +
        '</div>' +
        '<button type="button" class="dg-notes-identity-confirm" disabled>Start Writing</button>' +
        '</div>';
      document.body.appendChild(modal);
      let chosenColor = null, chosenFont = AGENT_FONTS[0].id;
      const confirmBtn = modal.querySelector('.dg-notes-identity-confirm');
      modal.querySelectorAll('[data-color]').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.querySelectorAll('[data-color]').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          chosenColor = btn.dataset.color;
          confirmBtn.disabled = !chosenColor;
        });
      });
      modal.querySelectorAll('[data-font]').forEach(btn => {
        btn.addEventListener('click', () => {
          modal.querySelectorAll('[data-font]').forEach(b => b.classList.remove('selected'));
          btn.classList.add('selected');
          chosenFont = btn.dataset.font;
        });
      });
      confirmBtn.addEventListener('click', () => {
        if (!chosenColor) return;
        myIdentity = { color: chosenColor, font: chosenFont };
        saveLocalIdentity(myIdentity);
        postAction({ action: 'save_agent_identity', agent_code: agentCode, color: chosenColor, font: chosenFont }).catch(() => { });
        modal.remove();
        render();
      });
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

    function sharedBlocksSorted() {
      return allVisibleBlocks()
        .filter(b => b.shared)
        .sort((a, b) => (a.created_at || a.updated_at || 0) - (b.created_at || b.updated_at || 0));
    }

    function matchesSearch(block) {
      if (!searchTerm) return true;
      const t = searchTerm.toLowerCase();
      return (block.text || '').toLowerCase().includes(t);
    }

    // Numbers only run within an unbroken streak of 'numbered' blocks in
    // rendering order -- a non-numbered block resets the count, so
    // reordering/deleting never leaves a stale number baked into stored
    // data (nothing numeric is stored at all; this runs fresh every render).
    function withNumbering(blocks) {
      let n = 0;
      return blocks.map(b => {
        if (normalizedType(b.block_type) === 'numbered') { n++; return Object.assign({}, b, { _num: n }); }
        n = 0;
        return b;
      });
    }

    function render() {
      ensureIdentity();

      const tabsHtml = '<button type="button" class="dg-notes-tab dg-notes-tab-shared' + (activeCode === SHARED_TAB ? ' active' : '') + '" data-tab="' + SHARED_TAB + '">Shared</button>' +
        memberCodes.map(code => {
          const cls = code === activeCode ? 'dg-notes-tab active' : 'dg-notes-tab';
          const id = identityFor(code);
          const dot = id ? '<span class="dg-notes-tab-dot" style="background:' + id.color + '"></span>' : '';
          return '<button type="button" class="' + cls + '" data-tab="' + escapeHtml(code) + '">' + dot + escapeHtml(memberLabel(code)) + '</button>';
        }).join('');

      const tocBlocks = allVisibleBlocks()
        .filter(b => isHeadingType(b.block_type))
        .sort((a, b) => (a.created_at || a.updated_at || 0) - (b.created_at || b.updated_at || 0));
      const tocHtml = tocBlocks.length
        ? tocBlocks.map(b => {
          const id = identityFor(b.agent_code);
          const dot = id ? '<span class="dg-notes-toc-dot" style="background:' + id.color + '"></span>' : '';
          const lvlCls = normalizedType(b.block_type) === 'h2' ? ' dg-notes-toc-h2' : '';
          return '<a href="#" class="dg-notes-toc-item' + lvlCls + '" data-scroll-to="' + escapeHtml(b.block_id) + '">' + dot + escapeHtml(b.text || '(untitled)') + '</a>';
        }).join('')
        : '<div class="dg-notes-toc-empty">No headings yet.</div>';

      let blocksHtml, showAddRow, emptyLabel;
      if (activeCode === SHARED_TAB) {
        const blocks = withNumbering(sharedBlocksSorted().filter(matchesSearch));
        blocksHtml = blocks.length
          ? blocks.map(b => renderBlock(b, { canEdit: b.agent_code === agentCode, showAuthor: true })).join('')
          : '';
        showAddRow = true;
        emptyLabel = searchTerm ? 'No shared blocks match your search.' : 'Nothing shared yet -- start the table’s notes below.';
      } else {
        const isOwnTab = activeCode === agentCode;
        const blocks = withNumbering((notesByCode[activeCode] || []).slice()
          .sort((a, b) => a.sort_order - b.sort_order).filter(matchesSearch));
        blocksHtml = blocks.length
          ? blocks.map(b => renderBlock(b, { canEdit: isOwnTab, showAuthor: false })).join('')
          : '';
        showAddRow = isOwnTab;
        emptyLabel = searchTerm ? 'No blocks match your search.' : (isOwnTab ? 'Nothing here yet -- add a block below.' : 'Nothing shared here yet.');
      }
      if (!blocksHtml) blocksHtml = '<div class="dg-notes-empty">' + emptyLabel + '</div>';

      container.innerHTML =
        '<div id="dg-notes-panel">' +
        '<div class="dg-notes-toolbar"><input type="search" class="dg-notes-search" placeholder="Search notes…" value="' + escapeHtml(searchTerm) + '"></div>' +
        '<div class="dg-notes-body">' +
        '<aside class="dg-notes-toc"><div class="dg-notes-toc-label">Index</div>' + tocHtml + '</aside>' +
        '<main class="dg-notes-main">' +
        '<div class="dg-notes-tabs">' + tabsHtml + '</div>' +
        '<div class="dg-notes-blocks">' + blocksHtml + '</div>' +
        (showAddRow ? renderAddRow() : '') +
        '</main></div></div>';

      wireEvents();
    }

    function renderBlock(b, ctx) {
      const type = normalizedType(b.block_type);

      if (type === 'divider') {
        return '<div class="dg-notes-block dg-notes-block-divider" id="block-' + escapeHtml(b.block_id) + '" data-block-id="' + escapeHtml(b.block_id) + '">' +
          '<hr class="dg-notes-divider-rule">' +
          (ctx.canEdit ? '<button type="button" class="dg-notes-block-del" data-delete="' + escapeHtml(b.block_id) + '" title="Delete">&times;</button>' : '') +
          '</div>';
      }

      const id = identityFor(b.agent_code);
      const inkStyle = id ? 'color:' + id.color + ';font-family:' + fontFamilyFor(id.font) + ';' : '';
      const isEditing = ctx.canEdit && editingBlockId === b.block_id;

      let fieldHtml;
      if (isEditing) {
        fieldHtml = (type === 'paragraph')
          ? '<textarea class="dg-notes-block-text" data-block-id="' + escapeHtml(b.block_id) + '" rows="3">' + escapeHtml(b.text) + '</textarea>'
          : '<input type="text" class="dg-notes-block-text" data-block-id="' + escapeHtml(b.block_id) + '" value="' + escapeHtml(b.text) + '">';
      } else {
        const rendered = b.text ? renderInline(b.text) : '<span class="dg-notes-block-placeholder">' + (ctx.canEdit ? 'Tap to write…' : '(empty)') + '</span>';
        fieldHtml = '<div class="dg-notes-block-view" style="' + inkStyle + '" data-block-id="' + escapeHtml(b.block_id) + '"' +
          (ctx.canEdit ? ' data-editable="1"' : '') + '>' + rendered + '</div>';
      }

      const prefix = type === 'numbered' ? '<span class="dg-notes-num">' + b._num + '.</span>'
        : type === 'bullet' ? '<span class="dg-notes-bullet">•</span>' : '';

      const toolbar = isEditing ? (
        '<div class="dg-notes-format-bar">' +
        '<button type="button" data-fmt="bold" title="Bold"><b>B</b></button>' +
        '<button type="button" data-fmt="italic" title="Italic"><i>I</i></button>' +
        '<button type="button" data-fmt="highlight" title="Highlight">HL</button>' +
        AGENT_COLORS.slice(0, 5).map(c => '<button type="button" class="dg-notes-fmt-color" data-fmt-color="' + c + '" style="background:' + c + '" title="Text color"></button>').join('') +
        '</div>'
      ) : '';

      const authorBadge = ctx.showAuthor
        ? '<span class="dg-notes-author-badge" style="' + (id ? 'background:' + id.color : '') + '">' + escapeHtml(memberLabel(b.agent_code)) + '</span>'
        : '';

      const controls = ctx.canEdit
        ? '<label class="dg-notes-shared-toggle"><input type="checkbox" data-shared-toggle="' + escapeHtml(b.block_id) + '" ' + (b.shared ? 'checked' : '') + '> Shared</label>' +
        '<button type="button" class="dg-notes-block-del" data-delete="' + escapeHtml(b.block_id) + '" title="Delete block">&times;</button>'
        : (ctx.showAuthor ? '' : '<span class="dg-notes-shared-badge">' + (b.shared ? 'Shared' : 'Private') + '</span>');

      return '<div class="dg-notes-block dg-notes-block-' + type + '" id="block-' + escapeHtml(b.block_id) + '" data-block-id="' + escapeHtml(b.block_id) + '">' +
        authorBadge +
        '<div class="dg-notes-block-row"><div class="dg-notes-block-field">' + prefix + fieldHtml + '</div>' +
        '<div class="dg-notes-block-controls">' + controls + '</div></div>' +
        toolbar +
        '</div>';
    }

    function renderAddRow() {
      return '<div class="dg-notes-add-row">' +
        BLOCK_TYPES.map(t => '<button type="button" class="dg-notes-add-btn" data-add-type="' + t.id + '">+ ' + t.label + '</button>').join('') +
        '</div>';
    }

    function wireEvents() {
      container.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => { activeCode = btn.dataset.tab; editingBlockId = null; render(); });
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
          const target = allVisibleBlocks().find(b => b.block_id === a.dataset.scrollTo);
          if (target) {
            const dest = target.shared ? SHARED_TAB : agentCode;
            if (dest !== activeCode) { activeCode = dest; render(); }
          }
          requestAnimationFrame(() => {
            const el = document.getElementById('block-' + a.dataset.scrollTo);
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
      });
      container.querySelectorAll('.dg-notes-block-view[data-editable]').forEach(view => {
        view.addEventListener('click', () => {
          const blockId = view.dataset.blockId;
          // Deferred a tick so any blur this click also triggers (leaving
          // whatever block was previously being edited) fully settles
          // first -- avoids two renders racing over the same DOM mutation.
          setTimeout(() => {
            editingBlockId = blockId;
            render();
            const field = container.querySelector('[data-block-id="' + blockId + '"].dg-notes-block-text');
            if (field) { field.focus(); if (field.setSelectionRange) field.setSelectionRange(field.value.length, field.value.length); }
          }, 0);
        });
      });
      container.querySelectorAll('.dg-notes-block-text').forEach(field => {
        const blockId = field.dataset.blockId;
        field.addEventListener('input', () => scheduleSave(blockId));
        field.addEventListener('blur', e => {
          // Focus moving to a control within this SAME block (the format
          // toolbar, the Shared checkbox, Delete) shouldn't exit edit
          // mode -- only actually leaving the block should swap it back
          // to its rendered view.
          const next = e.relatedTarget;
          if (next && next.closest && next.closest('[data-block-id="' + blockId + '"]')) return;
          editingBlockId = null;
          deferredRenderPending = false;
          render();
        });
      });
      container.querySelectorAll('[data-fmt]').forEach(btn => {
        btn.addEventListener('click', () => {
          const blockId = btn.closest('[data-block-id]').dataset.blockId;
          const field = container.querySelector('[data-block-id="' + blockId + '"].dg-notes-block-text');
          if (!field) return;
          const kind = btn.dataset.fmt;
          if (kind === 'bold') wrapSelection(field, '**', '**');
          else if (kind === 'italic') wrapSelection(field, '_', '_');
          else if (kind === 'highlight') wrapSelection(field, '==', '==');
        });
      });
      container.querySelectorAll('[data-fmt-color]').forEach(btn => {
        btn.addEventListener('click', () => {
          const blockId = btn.closest('[data-block-id]').dataset.blockId;
          const field = container.querySelector('[data-block-id="' + blockId + '"].dg-notes-block-text');
          if (!field) return;
          wrapSelection(field, '{color:' + btn.dataset.fmtColor + '}', '{/color}');
        });
      });
      container.querySelectorAll('[data-shared-toggle]').forEach(cb => {
        cb.addEventListener('change', () => scheduleSave(cb.dataset.sharedToggle, { immediate: true }));
      });
      container.querySelectorAll('[data-delete]').forEach(btn => {
        btn.addEventListener('click', () => deleteBlock(btn.dataset.delete));
      });
      container.querySelectorAll('[data-add-type]').forEach(btn => {
        btn.addEventListener('click', () => addBlock(btn.dataset.addType, { shared: activeCode === SHARED_TAB }));
      });
    }

    // Wraps the field's current text selection with formatting markers
    // (textarea/input's selectionStart/End is well-supported even on
    // mobile Safari, unlike contenteditable's Selection/Range API --
    // deliberately avoided here for the same reason a plain field was
    // kept for editing at all).
    function wrapSelection(fieldEl, before, after) {
      const start = fieldEl.selectionStart, end = fieldEl.selectionEnd;
      const val = fieldEl.value;
      const selected = val.slice(start, end) || 'text';
      fieldEl.value = val.slice(0, start) + before + selected + after + val.slice(end);
      fieldEl.focus();
      fieldEl.selectionStart = start + before.length;
      fieldEl.selectionEnd = start + before.length + selected.length;
      fieldEl.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function findBlockAnywhere(blockId) {
      for (const code of Object.keys(notesByCode)) {
        const found = (notesByCode[code] || []).find(b => b.block_id === blockId);
        if (found) return found;
      }
      return null;
    }

    function scheduleSave(blockId, opts2) {
      const block = findBlockAnywhere(blockId);
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

    function addBlock(blockType, addOpts) {
      const shared = !!(addOpts && addOpts.shared);
      const list = notesByCode[agentCode] || (notesByCode[agentCode] = []);
      const maxSort = list.reduce((m, b) => Math.max(m, b.sort_order), 0);
      const now = Date.now();
      const block = {
        block_id: mintBlockId(), block_type: blockType, text: '', shared: shared,
        sort_order: maxSort + 1000, created_at: now, updated_at: now,
      };
      list.push(block);
      activeCode = shared ? SHARED_TAB : agentCode;
      editingBlockId = blockType === 'divider' ? null : block.block_id;
      render();
      if (blockType !== 'divider') {
        const fieldEl = container.querySelector('[data-block-id="' + block.block_id + '"].dg-notes-block-text');
        if (fieldEl) fieldEl.focus();
      }
      saveBlock(block);
    }

    function deleteBlock(blockId) {
      const list = notesByCode[agentCode] || [];
      const idx = list.findIndex(b => b.block_id === blockId);
      if (idx === -1) return;
      list.splice(idx, 1);
      delete touchedAt[blockId];
      if (editingBlockId === blockId) editingBlockId = null;
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
        identities = res.identities || identities;
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
