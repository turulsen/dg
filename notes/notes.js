/* ══════════════════════════════════════════════
   PLAYER NOTES -- shared/private block notes scoped to a Cell, plus a
   combined Shared feed any Cell member can contribute to (by writing
   in their own tab and toggling Circulate on a block).

   v2: the editing surface is Editor.js (vendored under notes/vendor/,
   no bundler -- see that directory's files) instead of a hand-rolled
   textarea + custom markup syntax. Real WYSIWYG (native contenteditable
   Bold/Italic/Highlight, real Header/List/Paragraph/Delimiter blocks)
   and Editor.js's own paste handling, which auto-splits rich clipboard
   content (Google Docs, Notion) into proper blocks -- the actual
   motivation for this migration was "easy import from other note
   apps," and this is genuinely good at that (verified against
   representative Docs/Notion/Apple-Notes-shaped paste content before
   this was built, not assumed).

   Built as a self-mounting module (window.dgNotesPanel.init(el, opts))
   rather than a page-specific script, for the same reason as v1: a
   later phase can mount this exact module into a side panel on
   stats/index.html during Live Play without a rewrite.

   opts = {
     cellId: string,
     agentCode: string,        -- the viewer's own Agent Code (identity)
     memberCodes: string[],    -- every Agent Code in this Cell
     memberNames: {code: name} -- optional, for nicer tab labels
   }

   Architecture note (the central decision of this rewrite): Editor.js
   is fundamentally ONE EDITABLE DOCUMENT per instance -- it has no
   supported way to mix "my own editable blocks" with "someone else's
   read-only blocks" in the same instance. So only YOUR OWN tab ever
   mounts a live Editor.js instance; every other view (another member's
   tab, the combined Shared feed) is a small hand-rendered read-only
   HTML feed built directly from the same stored block data. This also
   means privacy/Circulate is now per-BLOCK, and a whole bulleted/
   numbered list counts as one block (Editor.js's List tool groups every
   item into one block -- there's no per-line privacy flag anymore, a
   confirmed, accepted trade-off for native lists + paste-splitting).

   The Circulate flag is deliberately never stored inside Editor.js's
   own block `data` or persisted through its Tunes save mechanism --
   it's tracked in this module's own `sharedByBlockId` map and synced
   through the exact same save_note_block action as everything else,
   as a plain top-level field. That's what keeps the backend's
   server-side privacy filter (listCellNotes() in Code.gs) completely
   unaffected by this migration -- it was never reading anything out
   of the block's own data to begin with.

   Every CSS class here (including the ones for Editor.js's own chrome,
   reskinned in notes.css) is authored/overridden under the
   #dg-notes-panel prefix -- same defensive-specificity trick
   assets/table-radio.js uses.
   ══════════════════════════════════════════════ */
(function () {
  "use strict";

  const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxF32nCIUfXDcTaKntKkt8az_7mwy8aOAKPD0mtaEZHcUEKmq0AF2b2k4V6FJNEzbIJZQ/exec';
  const POLL_MS = 5000; // slower than Table Radio's 2s -- note content changes far less often than "what's playing"
  const SAVE_DEBOUNCE_MS = 1200; // matches agent-hub.html's scheduleNoteSave() convention
  const SHARED_TAB = '__shared__'; // pseudo agent_code, never a real one -- selects the combined tab
  const HEADER_LEVELS = [1, 2]; // keeps the existing H1/H2-only vocabulary rather than Editor.js's default 1-6

  // Each Agent picks one of these once -- their "ink" -- to mark their
  // contributions in the combined Shared feed and on their own tab.
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
  function stripTags(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return d.textContent || '';
  }
  // @editorjs/list items are {content, meta, items} objects (nested
  // sublists live in .items) -- content is the one thing TOC/search
  // and the read-only renderer below actually need.
  function listItemContent(it) {
    return (it && typeof it === 'object') ? (it.content || '') : String(it || '');
  }

  // A flat, matchable text label for one stored block -- used by
  // search and the TOC (which only needs heading text). Deliberately
  // ignorant of block-specific meaning beyond "what text is in here."
  function plainTextOf(type, data) {
    data = data || {};
    if (type === 'header' || type === 'paragraph') return stripTags(data.text || '');
    if (type === 'list') return (data.items || []).map(it => stripTags(listItemContent(it))).join(' ');
    return '';
  }

  // Renders one stored block (type+data) as read-only HTML -- used for
  // a member's tab other than your own (never editable by you) and the
  // combined Shared feed. Editor.js's own tools sanitize `data.text`/
  // item content on save, so trusting it as HTML here is the same
  // trust level Editor.js itself gives its own saved data on reload.
  function renderReadOnlyBlock(type, data) {
    data = data || {};
    if (type === 'header') {
      const lvl = Number(data.level) === 2 ? 'h2' : 'h1';
      return '<' + lvl + '>' + (data.text || '') + '</' + lvl + '>';
    }
    if (type === 'paragraph') {
      return '<p>' + (data.text || '<span class="dg-notes-block-placeholder">(empty)</span>') + '</p>';
    }
    if (type === 'list') {
      const tag = data.style === 'ordered' ? 'ol' : 'ul';
      const items = (data.items || []).map(it => '<li>' + listItemContent(it) + '</li>').join('');
      return '<' + tag + '>' + items + '</' + tag + '>';
    }
    if (type === 'delimiter') return '<hr class="dg-notes-divider-rule">';
    // Unknown tool (or a future one this build doesn't have wired up
    // yet) -- show something rather than silently eating the block.
    return '<p class="dg-notes-block-placeholder">(' + escapeHtml(type) + ' block)</p>';
  }

  // Parses a CellNotes row's raw `text` column back into {type, data}.
  // `text` is a JSON string of the block's own Editor.js `data` object
  // as of this v2 rewrite -- a row whose text ISN'T valid JSON is a
  // leftover from before this migration (the old custom-markup plain
  // string), rendered as a plain paragraph with that raw text rather
  // than silently dropped.
  function parseStoredBlock(blockType, rawText) {
    try {
      return { type: blockType, data: JSON.parse(rawText) };
    } catch (e) {
      return { type: 'paragraph', data: { text: escapeHtml(rawText || '') } };
    }
  }

  // Same "remove the previous cycle's leftover script tag, then inject a
  // fresh one" JSONP convention used by table-radio.js's polling and
  // agent-hub.html's jsonpGet().
  function jsonpGet(action, params, cb) {
    const cbName = '_dgNotes_' + action + '_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
    const prevScript = document.getElementById('_dg_notes_jsonp_script');
    if (prevScript) prevScript.remove();
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
  // "low-stakes personal scratchpad" write.
  function postAction(payload) {
    return fetch(APPS_SCRIPT_URL, {
      method: 'POST', mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
  }

  function init(container, opts) {
    opts = opts || {};
    const cellId = opts.cellId;
    const agentCode = (opts.agentCode || '').trim().toUpperCase();
    const memberCodes = (opts.memberCodes || []).slice();
    if (memberCodes.indexOf(agentCode) === -1) memberCodes.unshift(agentCode);
    const memberNames = opts.memberNames || {};
    const IDENTITY_KEY = 'dg_notes_identity_' + agentCode;

    // agent_code -> [{block_id, agent_code, type, data, shared, sort_order, created_at, updated_at}]
    let notesByCode = {};
    let identities = {}; // agent_code -> {color, font}, from the server
    let myIdentity = null;
    let identityPromptShown = false;
    let activeCode = agentCode; // an Agent Code, or SHARED_TAB
    let searchTerm = '';
    let pollTimer = null;
    // The one live, editable Editor.js instance -- only ever mounted
    // while activeCode === agentCode (your own tab). A background poll
    // NEVER touches this instance or re-renders its container: Editor.js
    // owns its own DOM incrementally, so there's nothing left to defend
    // against here the way v1 had to (no destroy-mid-typing risk,
    // because nothing ever calls container.innerHTML on the mount point
    // while it's live).
    let editorInstance = null;
    // Circulate state per block, deliberately tracked here rather than
    // through Editor.js's own Tunes persistence -- see the file header
    // comment for why.
    const sharedByBlockId = {};
    const saveTimers = {}; // block_id -> debounce handle

    function memberLabel(code) {
      const base = memberNames[code] ? memberNames[code] + ' (' + code + ')' : code;
      return code === agentCode ? base + ' (You)' : base;
    }
    function identityFor(code) {
      if (code === agentCode && myIdentity) return myIdentity;
      return identities[code] || null;
    }
    function inkStyleFor(code) {
      const id = identityFor(code);
      return id ? 'color:' + id.color + ';font-family:' + fontFamilyFor(id.font) + ';' : '';
    }

    /* ── Identity: pick once, remembered per Agent Code both locally and
       server-side (so it follows the same Agent to another device).
       Unchanged from v1. ── */
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
    // innerHTML on tab switches, which would otherwise wipe this out
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
        applyOwnInkStyle();
        refreshChrome();
      });
    }

    function allVisibleBlocks() {
      const out = [];
      Object.keys(notesByCode).forEach(code => {
        (notesByCode[code] || []).forEach(b => out.push(b));
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
      return plainTextOf(block.type, block.data).toLowerCase().includes(searchTerm.toLowerCase());
    }

    function upsertLocalMeta(ownerCode, blockId, patch) {
      const list = notesByCode[ownerCode] || (notesByCode[ownerCode] = []);
      let entry = list.find(b => b.block_id === blockId);
      const now = Date.now();
      if (!entry) {
        entry = { block_id: blockId, agent_code: ownerCode, created_at: now, sort_order: list.length * 1000 };
        list.push(entry);
      }
      Object.assign(entry, patch, { updated_at: now });
      return entry;
    }
    function removeLocalMeta(ownerCode, blockId) {
      const list = notesByCode[ownerCode] || [];
      const idx = list.findIndex(b => b.block_id === blockId);
      if (idx !== -1) list.splice(idx, 1);
    }

    /* ── The shell: tabs, TOC, search bar, and either the live editor
       mount point (your own tab) or a read-only feed container
       (everything else). Rebuilt on tab switches, search-term changes,
       and initial load -- NOT on every poll/save, so it never tears
       down a live Editor.js instance out from under you. ── */
    function render() {
      ensureIdentity();
      // Unmount (flushing any pending debounced save first) BEFORE
      // touching container.innerHTML below -- unmountEditor()'s flush
      // needs the current DOM/instance intact to read from; doing this
      // after the innerHTML reassignment would try to read from an
      // already-replaced tree. A no-op if nothing is currently mounted.
      unmountEditor();

      const tabsHtml = '<button type="button" class="dg-notes-tab dg-notes-tab-shared' + (activeCode === SHARED_TAB ? ' active' : '') + '" data-tab="' + SHARED_TAB + '">Shared</button>' +
        memberCodes.map(code => {
          const cls = code === activeCode ? 'dg-notes-tab active' : 'dg-notes-tab';
          const id = identityFor(code);
          const dot = id ? '<span class="dg-notes-tab-dot" style="background:' + id.color + '"></span>' : '';
          return '<button type="button" class="' + cls + '" data-tab="' + escapeHtml(code) + '">' + dot + escapeHtml(memberLabel(code)) + '</button>';
        }).join('');

      const isOwnTab = activeCode === agentCode;
      const bodyHtml = isOwnTab
        ? '<div id="dg-notes-editor-mount"></div>'
        : '<div class="dg-notes-readonly-feed" id="dg-notes-readonly-feed"></div>';
      const circulateBtnHtml = isOwnTab
        ? '<button type="button" class="dg-notes-circulate-btn" disabled>' +
          '<span class="dg-notes-toggle-track"><span class="dg-notes-toggle-thumb"></span></span>' +
          '<span class="dg-notes-toggle-label">Circulate</span></button>'
        : '';

      container.innerHTML =
        '<div id="dg-notes-panel">' +
        '<div class="dg-notes-toolbar">' + circulateBtnHtml +
        '<input type="search" class="dg-notes-search" placeholder="Search notes…" value="' + escapeHtml(searchTerm) + '"></div>' +
        '<div class="dg-notes-body">' +
        '<aside class="dg-notes-toc"><div class="dg-notes-toc-label">Index</div><div id="dg-notes-toc-mount"></div></aside>' +
        '<main class="dg-notes-main">' +
        '<div class="dg-notes-tabs">' + tabsHtml + '</div>' +
        bodyHtml +
        '</main></div></div>';

      wireShellEvents();
      if (isOwnTab) {
        mountEditor();
      } else {
        refreshReadOnlyFeed();
      }
      refreshToc();
    }

    // Updates just the TOC and tab-dot colors in place, without
    // touching the editor mount or the read-only feed's own content --
    // safe to call after every poll and every debounced save.
    function refreshChrome() {
      refreshToc();
      container.querySelectorAll('[data-tab]').forEach(btn => {
        const code = btn.dataset.tab;
        if (code === SHARED_TAB) return;
        const id = identityFor(code);
        let dot = btn.querySelector('.dg-notes-tab-dot');
        if (id && !dot) {
          dot = document.createElement('span');
          dot.className = 'dg-notes-tab-dot';
          btn.insertBefore(dot, btn.firstChild);
        }
        if (dot) dot.style.background = id ? id.color : '';
      });
    }

    function refreshToc() {
      const mount = container.querySelector('#dg-notes-toc-mount');
      if (!mount) return;
      const tocBlocks = allVisibleBlocks()
        .filter(b => b.type === 'header')
        .sort((a, b) => (a.created_at || a.updated_at || 0) - (b.created_at || b.updated_at || 0));
      mount.innerHTML = tocBlocks.length
        ? tocBlocks.map(b => {
          const id = identityFor(b.agent_code);
          const dot = id ? '<span class="dg-notes-toc-dot" style="background:' + id.color + '"></span>' : '';
          const lvlCls = Number(b.data && b.data.level) === 2 ? ' dg-notes-toc-h2' : '';
          const label = plainTextOf('header', b.data) || '(untitled)';
          return '<a href="#" class="dg-notes-toc-item' + lvlCls + '" data-scroll-to="' + escapeHtml(b.block_id) + '" data-owner="' + escapeHtml(b.agent_code) + '">' + dot + escapeHtml(label) + '</a>';
        }).join('')
        : '<div class="dg-notes-toc-empty">No headings yet.</div>';
      wireTocEvents();
    }

    function refreshReadOnlyFeed() {
      const mount = container.querySelector('#dg-notes-readonly-feed');
      if (!mount) return;
      let blocks, emptyLabel, showAuthor;
      const isShared = activeCode === SHARED_TAB;
      if (isShared) {
        blocks = sharedBlocksSorted().filter(matchesSearch);
        showAuthor = true;
        emptyLabel = searchTerm ? 'No shared blocks match your search.' : 'Nothing shared yet.';
      } else {
        blocks = (notesByCode[activeCode] || []).slice().sort((a, b) => a.sort_order - b.sort_order).filter(matchesSearch);
        showAuthor = false;
        emptyLabel = searchTerm ? 'No blocks match your search.' : 'Nothing shared here yet.';
      }
      // This whole feed is read-only (see the file header comment for
      // why) -- without this, the Shared tab is a total dead end with
      // no controls at all, which read as "totally buggy, can't do
      // anything" the moment someone tapped over to look at it. Always
      // visible here, not just in the empty state, since it's the one
      // way off this tab into somewhere you can actually write.
      const composeHint = isShared
        ? '<button type="button" class="dg-notes-goto-own-btn" data-goto-own="1">Write on your own tab, then tap Circulate to add it here &rarr;</button>'
        : '';
      mount.innerHTML = composeHint + (blocks.length
        ? blocks.map(b => {
          const authorBadge = showAuthor
            ? '<span class="dg-notes-author-badge" style="background:' + (identityFor(b.agent_code) ? identityFor(b.agent_code).color : '#4a5568') + '">' + escapeHtml(memberLabel(b.agent_code)) + '</span>'
            : '<span class="dg-notes-shared-badge">' + (b.shared ? 'Circulated' : 'Private') + '</span>';
          return '<div class="dg-notes-ro-block" id="block-' + escapeHtml(b.block_id) + '" style="' + inkStyleFor(b.agent_code) + '">' + authorBadge + renderReadOnlyBlock(b.type, b.data) + '</div>';
        }).join('')
        : '<div class="dg-notes-empty">' + emptyLabel + '</div>');
      const gotoBtn = mount.querySelector('[data-goto-own]');
      if (gotoBtn) gotoBtn.addEventListener('click', () => { activeCode = agentCode; render(); });
    }

    function wireShellEvents() {
      container.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => { activeCode = btn.dataset.tab; render(); });
      });
      const search = container.querySelector('.dg-notes-search');
      if (search) {
        search.addEventListener('input', () => {
          searchTerm = search.value;
          if (activeCode === agentCode) {
            jumpToFirstMatch();
          } else {
            refreshReadOnlyFeed();
          }
        });
      }
      const circulateBtn = container.querySelector('.dg-notes-circulate-btn');
      if (circulateBtn) {
        circulateBtn.addEventListener('click', () => {
          if (!currentBlockId) return;
          const next = !sharedByBlockId[currentBlockId];
          sharedByBlockId[currentBlockId] = next;
          updateCirculateButton();
          scheduleSave(currentBlockId);
        });
      }
    }
    function wireTocEvents() {
      container.querySelectorAll('[data-scroll-to]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          const blockId = a.dataset.scrollTo;
          const owner = a.dataset.owner;
          const dest = owner === agentCode ? agentCode : (allVisibleBlocks().find(b => b.block_id === blockId && b.shared) ? SHARED_TAB : owner);
          if (dest !== activeCode) { activeCode = dest; render(); }
          requestAnimationFrame(() => {
            const el = document.getElementById('block-' + blockId) || (editorInstance && document.querySelector('[data-id="' + blockId + '"]'));
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          });
        });
      });
    }

    // On your own tab, search jumps to (and briefly highlights) the
    // first matching block instead of hiding non-matches -- Editor.js
    // doesn't support hiding individual blocks cleanly while a live
    // instance is mounted, and "jump to it" is standard behavior for
    // search-in-a-real-editor anyway (this is what Notion's own search
    // does, for instance).
    function jumpToFirstMatch() {
      if (!editorInstance || !searchTerm) return;
      editorInstance.save().then(out => {
        const idx = out.blocks.findIndex(b => plainTextOf(b.type, b.data).toLowerCase().includes(searchTerm.toLowerCase()));
        if (idx === -1) return;
        const el = container.querySelectorAll('.ce-block')[idx];
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          el.classList.add('dg-notes-search-hit');
          setTimeout(() => el.classList.remove('dg-notes-search-hit'), 1200);
        }
      });
    }

    // Applies your own ink to the whole editor's writing surface --
    // simpler than a per-block Tune, since every block in your own
    // live document is authored by you (a per-author decorator only
    // matters for the read-only feeds, which mix multiple authors).
    function applyOwnInkStyle() {
      const mount = container.querySelector('#dg-notes-editor-mount');
      if (mount) mount.setAttribute('style', inkStyleFor(agentCode));
    }

    /* ── The live editor: mounted only for your own tab.

       Circulate is NOT implemented via Editor.js's own Block Tunes API,
       despite that being the "obvious" fit -- verified hands-on
       (matching isTune/render() exactly as documented, registered both
       as a top-level global tune AND per-tool) that a custom tune's
       render() output never actually reaches this pinned version's
       settings popover; codex-team/editor.js discussion #2819 confirms
       "apply a tune to every tool" is a known, still-open rough edge in
       Editor.js itself. Circulate is instead a single toolbar button
       that always acts on "whichever block your cursor is currently
       in" (tracked via focusin on the editor mount) -- still true
       per-block granularity, just triggered from outside Editor.js's
       own UI instead of fighting an unreliable API for it. ── */

    let currentBlockId = null;

    function updateCirculateButton() {
      const btn = container.querySelector('.dg-notes-circulate-btn');
      if (!btn) return;
      const known = !!currentBlockId;
      btn.disabled = !known;
      btn.classList.toggle('active', known && !!sharedByBlockId[currentBlockId]);
      btn.title = known ? 'Circulate this block to the whole Cell' : 'Click into a block first';
    }

    function mountEditor() {
      if (editorInstance) return; // never remounted while already live (a poll must not trigger this)
      currentBlockId = null;
      const initialBlocks = (notesByCode[agentCode] || []).slice()
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(b => {
          sharedByBlockId[b.block_id] = !!b.shared;
          return { id: b.block_id, type: b.type, data: b.data };
        });
      editorInstance = new EditorJS({
        holder: 'dg-notes-editor-mount',
        placeholder: 'Start writing…',
        data: { blocks: initialBlocks },
        // Bold/Italic/Highlight consistently on every block type,
        // rather than hand-tuning per tool.
        inlineToolbar: true,
        tools: {
          header: { class: Header, config: { levels: HEADER_LEVELS, defaultLevel: HEADER_LEVELS[0] } },
          list: EditorjsList,
          delimiter: Delimiter,
          marker: Marker,
        },
        onReady: () => {
          applyOwnInkStyle();
          const mount = container.querySelector('#dg-notes-editor-mount');
          if (mount) mount.addEventListener('focusin', () => {
            const blockEl = document.activeElement && document.activeElement.closest('.ce-block');
            currentBlockId = blockEl ? blockEl.dataset.id : currentBlockId;
            updateCirculateButton();
          });
        },
        onChange: handleEditorChange,
      });
    }
    // Flushes any still-debounced saves (in ONE final save() call, so
    // it can't race the destroy() that follows) before tearing the
    // instance down -- otherwise switching tabs within SAVE_DEBOUNCE_MS
    // of your last keystroke would silently drop that edit: the pending
    // setTimeout would still fire later, but syncBlock() bails out the
    // moment editorInstance is null.
    function unmountEditor() {
      if (!editorInstance) return;
      const pending = Object.keys(saveTimers);
      pending.forEach(id => { clearTimeout(saveTimers[id]); delete saveTimers[id]; });
      const inst = editorInstance;
      editorInstance = null;
      const finish = () => inst.destroy();
      if (pending.length) {
        inst.save().then(out => pending.forEach(id => persistBlockFromSaved(out, id))).catch(() => { }).then(finish);
      } else {
        finish();
      }
    }

    function handleEditorChange(api, event) {
      const events = Array.isArray(event) ? event : [event];
      let moved = false;
      events.forEach(e => {
        const blockId = e.detail && e.detail.target && e.detail.target.id;
        if (e.type === 'block-moved') { moved = true; return; }
        if (!blockId) return;
        if (e.type === 'block-removed') { deleteBlockRemote(blockId); return; }
        scheduleSave(blockId);
      });
      // A drag-reorder (or move-up/down) shifts every sibling's
      // effective position, not just the moved block's -- resync every
      // block's sort_order rather than just the one event reported.
      if (moved) resyncOrder();
    }

    function scheduleSave(blockId) {
      clearTimeout(saveTimers[blockId]);
      saveTimers[blockId] = setTimeout(() => syncBlock(blockId), SAVE_DEBOUNCE_MS);
    }

    // Shared by syncBlock(), resyncOrder(), and unmountEditor()'s final
    // flush -- given an already-fetched editor.save() result, updates
    // local bookkeeping and fires the actual save_note_block POST for
    // one block. A no-op if the block was deleted before this ran.
    function persistBlockFromSaved(out, blockId) {
      const b = out.blocks.find(x => x.id === blockId);
      if (!b) return;
      const idx = out.blocks.indexOf(b);
      const shared = !!sharedByBlockId[blockId];
      const meta = upsertLocalMeta(agentCode, blockId, { type: b.type, data: b.data, shared, sort_order: idx * 1000 });
      postAction({
        action: 'save_note_block', block_id: blockId, cell_id: cellId, agent_code: agentCode,
        block_type: b.type, text: JSON.stringify(b.data), shared, sort_order: meta.sort_order,
      }).catch(() => { });
    }

    function syncBlock(blockId) {
      delete saveTimers[blockId];
      if (!editorInstance) return;
      editorInstance.save().then(out => { persistBlockFromSaved(out, blockId); refreshChrome(); });
    }

    // Renumbers every block's stored sort_order to match the editor's
    // current visual order after a drag/move -- only actually posts an
    // update for the blocks whose sort_order changed.
    function resyncOrder() {
      if (!editorInstance) return;
      editorInstance.save().then(out => {
        out.blocks.forEach((b, idx) => {
          const existing = (notesByCode[agentCode] || []).find(x => x.block_id === b.id);
          if (existing && existing.sort_order === idx * 1000) return;
          persistBlockFromSaved(out, b.id);
        });
        refreshChrome();
      });
    }

    function deleteBlockRemote(blockId) {
      removeLocalMeta(agentCode, blockId);
      delete sharedByBlockId[blockId];
      clearTimeout(saveTimers[blockId]);
      postAction({ action: 'delete_note_block', block_id: blockId, cell_id: cellId }).catch(() => { });
      refreshChrome();
    }

    /* ── Polling: refreshes everyone else's data (and your own row's
       server-echoed metadata, harmlessly) every 5s. Never touches the
       live editor instance or re-renders the shell -- only the TOC/
       tab-dot chrome and, if you're not on your own tab, the read-only
       feed. Your own tab's actual content is only ever written by
       YOU, through the editor's own onChange -- there's no merge race
       to defend against anymore, because a background poll's data is
       never fed back into the one place you could be actively typing. ── */
    function fetchNotes() {
      if (!cellId) return;
      jsonpGet('list_cell_notes', { cell_id: cellId, agent_code: agentCode }, res => {
        if (!res || res.status !== 'OK') return;
        const incoming = res.notes || {};
        const parsed = {};
        Object.keys(incoming).forEach(code => {
          parsed[code] = (incoming[code] || []).map(row => {
            const b = parseStoredBlock(row.block_type, row.text);
            return {
              block_id: row.block_id, agent_code: row.agent_code, type: b.type, data: b.data,
              shared: !!row.shared, sort_order: row.sort_order, created_at: row.created_at, updated_at: row.updated_at,
            };
          });
        });
        // Your own tab's live document is the source of truth while
        // you're on it -- don't let a poll's (possibly-lagging) echo of
        // your own writes overwrite notesByCode[agentCode] out from
        // under the editor's own bookkeeping.
        if (activeCode === agentCode && editorInstance) delete parsed[agentCode];
        Object.assign(notesByCode, parsed);
        identities = res.identities || identities;
        refreshChrome();
        if (activeCode !== agentCode) refreshReadOnlyFeed();
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

    return {
      refresh: fetchNotes,
      destroy: () => { stopPolling(); unmountEditor(); },
    };
  }

  window.dgNotesPanel = { init };
})();
