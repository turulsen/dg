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
     memberNames: {code: name} -- optional, for nicer author-badge labels
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
  // Widened (was 5000ms flat) and jittered (see POLL_JITTER_MS/
  // startPolling() below) after live reports of intermittent backend
  // timeouts under real concurrent load -- several tabs' Notes panels,
  // Table Radio widgets, and character-sheet autosaves all share the
  // same Apps Script project/Sheet. A fixed setInterval also means
  // every Notes panel opened around the same moment polls in lockstep
  // forever after; a self-rescheduling setTimeout with jitter spreads
  // that back out. Still slower than Table Radio's own poll -- note
  // content changes far less often than "what's playing".
  const POLL_MS = 8000;
  const POLL_JITTER_MS = 2000;
  const SAVE_DEBOUNCE_MS = 1200; // matches agent-hub.html's scheduleNoteSave() convention
  const SHARED_TAB = '__shared__'; // pseudo agent_code, never a real one -- selects the combined tab
  const HEADER_LEVELS = [1, 2]; // keeps the existing H1/H2-only vocabulary rather than Editor.js's default 1-6

  // Each Agent picks one of these once -- their "ink" -- to mark their
  // contributions in the combined Shared feed and on their own tab.
  const AGENT_COLORS = ['#2b6cb0', '#2f855a', '#b7791f', '#805ad5', '#c53030', '#d53f8c', '#2c7a7b', '#4a5568'];
  const AGENT_FONTS = [
    { id: 'nycd', label: 'Nothing You Could Do', family: "'Nothing You Could Do', cursive" },
    { id: 'shadows', label: 'Shadows Into Light', family: "'Shadows Into Light', cursive" },
    { id: 'reenie', label: 'Reenie Beanie', family: "'Reenie Beanie', cursive" },
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
    // Backend hardening: list_cell_notes/save_note_block/
    // delete_note_block/save_agent_identity now need this Agent's own
    // secret token (see requireAgentToken_() in Code.gs). Sourced from
    // opts rather than minted in here -- notes/index.html already reads
    // the same dg_agent_roster entry to auto-load the Cover Identity in
    // the first place, so it mints/persists the token there and just
    // passes it through, one place per browser tab that owns the
    // roster instead of two.
    const agentToken = (opts.agentToken || '').trim();
    const memberNames = opts.memberNames || {};
    const IDENTITY_KEY = 'dg_notes_identity_' + agentCode;

    // agent_code -> [{block_id, agent_code, type, data, shared, sort_order, created_at, updated_at}]
    let notesByCode = {};
    let identities = {}; // agent_code -> {color, font}, from the server
    let myIdentity = null;
    let identityPromptShown = false;
    let activeCode = agentCode; // an Agent Code, or SHARED_TAB
    let searchTerm = '';
    // Regroups the Shared tab's normally-flat chronological feed into
    // date-headed sections, so a Handler/player can reconstruct what
    // happened when across the whole Cell without hunting through each
    // member's own tab -- same data as the flat view (shared blocks
    // only), just a different grouping. Only meaningful on SHARED_TAB;
    // left on when switching away and back is fine, matches how a
    // Cell filter or search term would persist too.
    let timelineMode = false;
    // A per-viewer reading preference (not per-Agent identity, so it's
    // keyed by browser/localStorage only, no server round trip): when
    // on, every author's chosen cursive "ink" font is ignored in favor
    // of the site's own plain Special Elite (headers) / Courier Prime
    // (body) look, everywhere ink normally shows -- your own tab, every
    // read-only feed, the combined Shared feed. Author COLOR still
    // applies either way; only the handwriting font toggles off, for
    // anyone who finds the cursive fonts harder to read.
    const PLAIN_FONTS_KEY = 'dg_notes_plain_fonts';
    let plainFonts = false;
    try { plainFonts = localStorage.getItem(PLAIN_FONTS_KEY) === '1'; } catch (e) { /* best effort */ }
    // Cross-tab search: normally the search box only filters whichever
    // tab is currently active (own tab jumps to the first live match;
    // a read-only feed hides non-matches). This widens the sidebar
    // Index into a combined Search Results list across every block
    // actually visible to you (your own, any privacy, plus everyone
    // else's shared blocks) -- not a second search mode, the same
    // searchTerm, just a wider net.
    let searchEverywhere = false;
    let pollTimer = null;
    // The one live, editable Editor.js instance -- only ever mounted
    // while activeCode === agentCode (your own tab). A background poll
    // NEVER touches this instance or re-renders its container: Editor.js
    // owns its own DOM incrementally, so there's nothing left to defend
    // against here the way v1 had to (no destroy-mid-typing risk,
    // because nothing ever calls container.innerHTML on the mount point
    // while it's live).
    let editorInstance = null;
    // Circulate/Pin state per block, deliberately tracked here rather
    // than through Editor.js's own Tunes persistence -- see the file
    // header comment for why. Tags follows the same pattern (an array
    // of {type, label} per block_id, not stored in Editor.js's own
    // block `data`).
    const sharedByBlockId = {};
    const pinnedByBlockId = {};
    const tagsByBlockId = {};
    const saveTimers = {}; // block_id -> debounce handle

    // Evidence, surfaced inside Notes: a per-Cell-member view of
    // whatever the Handler has filed and released (or restricted
    // specifically to this Agent) via A-Cell's Evidence Locker,
    // fetched independently of the notes themselves (see fetchEvidence()
    // below). evidenceSeenMap comes bundled in that same response
    // (server-side EvidenceSeen sheet, synced across devices rather
    // than a local-only flag). Remarks (players annotating a piece of
    // evidence, privately or shared) reuse the existing CellNotes table
    // via a plain evidence_remark block_type -- see mountEditor()'s own
    // comment for why those never enter the live editor or the general
    // Shared feed.
    let evidenceItems = [];
    let evidenceSeenMap = {};
    let evidenceModalEl = null;
    // Every 5s poll tick re-renders an already-open modal (see
    // fetchEvidence() below) so a Cell-mate's new remark shows up live --
    // but a Drive-backed photo doesn't change between polls, so without
    // this cache each tick would blank it back to the loading placeholder
    // and re-fetch it from Drive, flickering the image on and off in
    // lockstep with the poll interval.
    const evidencePhotoCache_ = {};

    const TAG_TYPES = [
      { id: 'npc', label: 'NPC' },
      { id: 'location', label: 'Location' },
      { id: 'clue', label: 'Clue' },
    ];
    let tagPopoverOpen = false;
    let tagPopoverType = TAG_TYPES[0].id;

    function memberLabel(code) {
      const base = memberNames[code] || code;
      return code === agentCode ? base + ' (You)' : base;
    }
    function identityFor(code) {
      if (code === agentCode && myIdentity) return myIdentity;
      return identities[code] || null;
    }
    function inkStyleFor(code) {
      const id = identityFor(code);
      if (!id) return '';
      // Plain-fonts mode keeps the author's color (still a useful
      // at-a-glance cue) but drops their cursive font, falling back to
      // this panel's own default type -- Special Elite for headers,
      // Courier Prime for everything else. --ink-font is a CSS custom
      // property, not a plain font-family, so headers/body/lists can
      // each keep their OWN default when it's unset -- see the matching
      // comment in notes.css above .dg-notes-ro-block h1 for why a
      // plain inherited font-family can't do that.
      return plainFonts ? 'color:' + id.color + ';' : 'color:' + id.color + ';--ink-font:' + fontFamilyFor(id.font) + ';';
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
        postAction({ action: 'save_agent_identity', agent_code: agentCode, token: agentToken, color: chosenColor, font: chosenFont }).catch(() => { });
        modal.remove();
        applyOwnInkStyle();
        refreshChrome();
      });
    }

    /* ── Evidence, surfaced in the sidebar + a detail modal. Fetched
       independently of the notes themselves (own list_evidence call,
       own poll-adjacent refresh) since it's a different data source
       entirely -- A-Cell's Evidence Locker, not CellNotes -- that just
       happens to share this same per-Cell, per-Agent visibility model.
       Remarks are the one piece that genuinely lives in CellNotes (see
       the evidenceItems/evidenceSeenMap declaration above for why). ── */

    function extractDriveId_(url) {
      if (!url) return null;
      const m = String(url).match(/^gdrive:(.+)$/);
      return m ? m[1] : null;
    }

    // A raw data: URI opened via <a target="_blank"> reliably shows a
    // blank "about:blank" tab instead of the PDF in Safari (and, in
    // some versions, other browsers too) -- treated as a top-level
    // navigation to an untrusted data: URI and blocked, silently,
    // rather than with any visible error. A blob: URL doesn't hit that
    // restriction, so PDF links are built from one instead.
    function dataUriToBlobUrl_(dataUri) {
      try {
        const [meta, b64] = dataUri.split(',');
        const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'application/octet-stream';
        const binary = atob(b64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch (e) {
        return dataUri; // best effort -- still better than throwing
      }
    }

    // Resolves a gdrive: link to a data URI via the imgdata JSONP proxy
    // -- same pattern a-cell.html/agent-hub.html already use for their
    // own Evidence photo previews, duplicated here rather than shared
    // (every module in this app keeps its own small copy of helpers
    // like this, see jsonpGet() above's own comment for the convention).
    function loadEvidencePhotoDataUri_(photoUrl, onReady) {
      const id = extractDriveId_(photoUrl);
      if (!id) return;
      const cbName = '_dgNotesEvPhoto_' + id.replace(/[^a-zA-Z0-9]/g, '_') + '_' + Date.now() + '_' + Math.floor(Math.random() * 1e6);
      const s = document.createElement('script');
      window[cbName] = function (json) {
        delete window[cbName];
        if (s.parentNode) s.remove();
        if (json && json.status === 'OK' && json.dataUri) onReady(json.dataUri);
      };
      s.src = APPS_SCRIPT_URL + '?action=imgdata&id=' + encodeURIComponent(id) + '&callback=' + cbName;
      document.head.appendChild(s);
    }

    function fetchEvidence() {
      if (!cellId) return;
      jsonpGet('list_evidence', { agent_code: agentCode, token: agentToken }, res => {
        if (!res || res.status !== 'OK' || !Array.isArray(res.evidence)) return;
        evidenceItems = res.evidence.slice().sort((a, b) => Number(b.created_at) - Number(a.created_at));
        evidenceSeenMap = res.seen || {};
        refreshEvidenceSidebar();
        // Keeps an already-open detail modal in sync with a fresh poll
        // -- a Cell-mate's new remark should show up without having to
        // close and reopen it.
        if (evidenceModalEl) renderEvidenceModalBody_(evidenceModalEl.dataset.evidenceId);
      });
    }

    function refreshEvidenceSidebar() {
      const mount = container.querySelector('#dg-notes-evidence-mount');
      if (!mount) return;
      if (!evidenceItems.length) { mount.innerHTML = ''; return; }
      mount.innerHTML =
        '<div class="dg-notes-toc-subhead">Evidence</div>' +
        evidenceItems.map(h => {
          const unseen = !evidenceSeenMap[h.evidence_id];
          return '<a href="#" class="dg-notes-evidence-item" data-evidence-id="' + escapeHtml(h.evidence_id) + '">' +
            '<span class="dg-notes-evidence-dot' + (unseen ? ' unseen' : '') + '"></span>' +
            '<span class="dg-notes-evidence-title">' + escapeHtml(h.title) + '</span>' +
            '</a>';
        }).join('');
      mount.querySelectorAll('[data-evidence-id]').forEach(a => {
        a.addEventListener('click', e => { e.preventDefault(); openEvidenceModal(a.dataset.evidenceId); });
      });
    }

    function markEvidenceSeenIfNeeded_(evidenceId) {
      if (evidenceSeenMap[evidenceId]) return;
      evidenceSeenMap[evidenceId] = true;
      refreshEvidenceSidebar();
      postAction({ action: 'mark_evidence_seen', agent_code: agentCode, evidence_id: evidenceId }).catch(() => { });
    }

    // Every remark attached to one Evidence item that's actually
    // visible to you -- your own (any privacy) plus any Cell member's
    // shared one, exactly the same visibility rule as everything else
    // in CellNotes (server-side filter already applied, nothing extra
    // to guard against here).
    function remarksFor_(evidenceId) {
      return allVisibleBlocks()
        .filter(b => b.type === 'evidence_remark' && b.data && b.data.evidence_id === evidenceId)
        .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    }

    function renderEvidenceModalBody_(evidenceId) {
      if (!evidenceModalEl) return;
      const h = evidenceItems.find(x => x.evidence_id === evidenceId);
      const body = evidenceModalEl.querySelector('.dg-notes-evidence-body');
      if (!h || !body) return;

      let photoHtml = '';
      if (h.photo) {
        if (extractDriveId_(h.photo)) {
          const cached = evidencePhotoCache_[evidenceId];
          const cachedDataUri = (cached && cached.src === h.photo) ? cached.dataUri : null;
          photoHtml = cachedDataUri
            ? (cachedDataUri.indexOf('data:application/pdf') === 0
              ? '<div class="dg-notes-evidence-photo-pdf"><a href="' + dataUriToBlobUrl_(cachedDataUri) + '" target="_blank" rel="noopener">&#128196; Open PDF</a></div>'
              : '<img class="dg-notes-evidence-photo-img" src="' + cachedDataUri + '" alt="">')
            : '<div class="dg-notes-evidence-photo-wrap"></div>';
        } else if (h.photo.indexOf('data:application/pdf') === 0) {
          photoHtml = '<div class="dg-notes-evidence-photo-pdf"><a href="' + dataUriToBlobUrl_(h.photo) + '" target="_blank" rel="noopener">&#128196; Open PDF</a></div>';
        } else {
          photoHtml = '<img class="dg-notes-evidence-photo-img" src="' + h.photo + '" alt="">';
        }
      }

      const remarks = remarksFor_(evidenceId);
      const remarksHtml = remarks.length
        ? remarks.map(r => {
          const id = identityFor(r.agent_code);
          const mine = r.agent_code === agentCode;
          const privBadge = '<span class="dg-notes-shared-badge">' + (r.shared ? 'Circulated' : 'Private') + '</span>';
          const delBtn = mine ? '<button type="button" class="dg-notes-evidence-remark-del" data-remark-id="' + escapeHtml(r.block_id) + '">&times;</button>' : '';
          return '<div class="dg-notes-evidence-remark">' +
            '<div class="dg-notes-evidence-remark-head">' +
            '<span class="dg-notes-author-badge" style="background:' + (id ? id.color : '#4a5568') + '">' + escapeHtml(mine ? 'You' : memberLabel(r.agent_code)) + '</span>' +
            privBadge + delBtn +
            '</div>' +
            '<div class="dg-notes-evidence-remark-text">' + escapeHtml((r.data && r.data.text) || '') + '</div>' +
            '</div>';
        }).join('')
        : '<div class="dg-notes-empty">No remarks yet.</div>';

      body.innerHTML =
        '<div class="dg-notes-identity-title">' + escapeHtml(h.title) + '</div>' +
        photoHtml +
        (h.body ? '<p class="dg-notes-evidence-body-text">' + escapeHtml(h.body) + '</p>' : '') +
        '<div class="dg-notes-toc-subhead">Remarks</div>' +
        '<div class="dg-notes-evidence-remarks-list">' + remarksHtml + '</div>' +
        '<div class="dg-notes-evidence-compose">' +
        '<textarea class="dg-notes-evidence-remark-input" placeholder="Add a remark…"></textarea>' +
        '<label class="dg-notes-toggle-label-inline"><input type="checkbox" class="dg-notes-evidence-remark-shared"> Share with your Cell</label>' +
        '<button type="button" class="dg-notes-evidence-remark-add">Add Remark</button>' +
        '</div>';

      const alreadyCached = evidencePhotoCache_[evidenceId] && evidencePhotoCache_[evidenceId].src === h.photo;
      if (extractDriveId_(h.photo) && !alreadyCached) {
        loadEvidencePhotoDataUri_(h.photo, dataUri => {
          evidencePhotoCache_[evidenceId] = { src: h.photo, dataUri: dataUri };
          const wrap = body.querySelector('.dg-notes-evidence-photo-wrap');
          if (!wrap) return;
          wrap.innerHTML = dataUri.indexOf('data:application/pdf') === 0
            ? '<div class="dg-notes-evidence-photo-pdf"><a href="' + dataUriToBlobUrl_(dataUri) + '" target="_blank" rel="noopener">&#128196; Open PDF</a></div>'
            : '<img class="dg-notes-evidence-photo-img" src="' + dataUri + '" alt="">';
        });
      }

      body.querySelector('.dg-notes-evidence-remark-add').addEventListener('click', () => {
        const input = body.querySelector('.dg-notes-evidence-remark-input');
        const text = input.value.trim();
        if (!text) return;
        const shared = body.querySelector('.dg-notes-evidence-remark-shared').checked;
        const blockId = 'block_' + Date.now() + '_' + Math.floor(Math.random() * 100000).toString(36);
        const now = Date.now();
        const list = notesByCode[agentCode] || (notesByCode[agentCode] = []);
        const sortOrder = list.length * 1000;
        list.push({
          block_id: blockId, agent_code: agentCode, type: 'evidence_remark',
          data: { evidence_id: evidenceId, text: text }, shared: shared, pinned: false,
          tags: [], sort_order: sortOrder, created_at: now, updated_at: now,
        });
        postAction({
          action: 'save_note_block', block_id: blockId, cell_id: cellId, agent_code: agentCode, token: agentToken,
          block_type: 'evidence_remark', text: JSON.stringify({ evidence_id: evidenceId, text: text }),
          shared: shared, pinned: false, tags: '[]', sort_order: sortOrder,
        }).catch(() => { });
        renderEvidenceModalBody_(evidenceId);
      });
      body.querySelectorAll('.dg-notes-evidence-remark-del').forEach(btn => {
        btn.addEventListener('click', () => {
          const blockId = btn.dataset.remarkId;
          const list = notesByCode[agentCode] || [];
          const idx = list.findIndex(x => x.block_id === blockId);
          if (idx !== -1) list.splice(idx, 1);
          postAction({ action: 'delete_note_block', block_id: blockId, cell_id: cellId, agent_code: agentCode, token: agentToken }).catch(() => { });
          renderEvidenceModalBody_(evidenceId);
        });
      });
    }

    // Appended to document.body (not `container`) and removed
    // explicitly on close -- same reasoning as showIdentityPicker()'s
    // own comment (render() would otherwise wipe it out mid-view on
    // the next poll/tab switch).
    function openEvidenceModal(evidenceId) {
      if (!evidenceItems.find(x => x.evidence_id === evidenceId)) return;
      closeEvidenceModal();
      const modal = document.createElement('div');
      modal.className = 'dg-notes-identity-modal dg-notes-evidence-modal';
      modal.dataset.evidenceId = evidenceId;
      modal.innerHTML =
        '<div class="dg-notes-identity-card dg-notes-evidence-card">' +
        '<button type="button" class="dg-notes-evidence-close">&times;</button>' +
        '<div class="dg-notes-evidence-body"></div>' +
        '</div>';
      modal.addEventListener('click', e => { if (e.target === modal) closeEvidenceModal(); });
      document.body.appendChild(modal);
      evidenceModalEl = modal;
      modal.querySelector('.dg-notes-evidence-close').addEventListener('click', closeEvidenceModal);
      renderEvidenceModalBody_(evidenceId);
      markEvidenceSeenIfNeeded_(evidenceId);
    }
    function closeEvidenceModal() {
      if (evidenceModalEl) { evidenceModalEl.remove(); evidenceModalEl = null; }
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
        // evidence_remark blocks are shown only in the Evidence detail
        // modal, never mixed into the general Shared feed -- see
        // mountEditor()'s own filter for the fuller reasoning.
        .filter(b => b.shared && b.type !== 'evidence_remark')
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

      // Only two tabs: your own (live, editable) and the combined Shared
      // feed -- no per-member tabs. Earlier versions gave every Cell
      // member their own read-only tab, but a member's tab only ever
      // showed their SHARED blocks anyway (their private ones are never
      // sent to anyone else), which is exactly the Shared feed's own
      // content, just split per-author for no real benefit -- and it
      // meant clicking around the Cell's other members before finding
      // anything worth reading. Their contributions still show up (and
      // are still individually attributed via the author badge) on the
      // Shared tab.
      const myId = identityFor(agentCode);
      const myInkStyle = myId ? ' style="--tab-ink:' + myId.color + '"' : '';
      const tabsHtml = '<button type="button" class="dg-notes-tab dg-notes-tab-shared' + (activeCode === SHARED_TAB ? ' active' : '') + '" data-tab="' + SHARED_TAB + '">Shared</button>' +
        '<button type="button" class="dg-notes-tab' + (activeCode === agentCode ? ' active' : '') + '" data-tab="' + escapeHtml(agentCode) + '"' + myInkStyle + '>' + escapeHtml(memberLabel(agentCode)) + '</button>';

      const isOwnTab = activeCode === agentCode;
      const bodyHtml = isOwnTab
        ? '<div id="dg-notes-editor-mount"></div>'
        : '<div class="dg-notes-readonly-feed" id="dg-notes-readonly-feed"></div>';
      const circulateBtnHtml = isOwnTab
        ? '<button type="button" class="dg-notes-circulate-btn" disabled>' +
          '<span class="dg-notes-toggle-track"><span class="dg-notes-toggle-thumb"></span></span>' +
          '<span class="dg-notes-toggle-label">Circulate</span></button>'
        : '';
      // Pin/Tag: same "acts on whichever block your cursor is in"
      // mechanism as Circulate (see the big comment above mountEditor()
      // for why this isn't an Editor.js Block Tune).
      const pinBtnHtml = isOwnTab
        ? '<button type="button" class="dg-notes-pin-btn" disabled>' +
          '<span class="dg-notes-toggle-track"><span class="dg-notes-toggle-thumb"></span></span>' +
          '<span class="dg-notes-toggle-label">Pin</span></button>'
        : '';
      const tagBtnHtml = isOwnTab
        ? '<div class="dg-notes-tag-wrap">' +
          '<button type="button" class="dg-notes-tag-btn" disabled>Tag</button>' +
          '<div class="dg-notes-tag-popover" id="dg-notes-tag-popover" hidden></div>' +
          '</div>'
        : '';
      // Only meaningful on the combined Shared feed -- a single
      // member's own tab is already their personal chronological view,
      // grouping it by date wouldn't add anything.
      const timelineBtnHtml = activeCode === SHARED_TAB
        ? '<button type="button" class="dg-notes-timeline-btn' + (timelineMode ? ' active' : '') + '">' +
          (timelineMode ? 'Flat view' : 'Group by date') + '</button>'
        : '';

      // Same folder/tab-strip/paper nesting as the rest of the site
      // (assets/theme-folder.css: .tab-strip sits ABOVE .folder-body as
      // a sibling, not inside it) -- #dg-notes-panel is now that outer
      // folder wrapper, not the paper itself. .dg-notes-folder-body is
      // the tan "grey" layer every folder tab strip sits on top of;
      // .dg-notes-paper is the actual cream sheet (ruled lines, red
      // margin, hole punches, same as .paper elsewhere) nested inside
      // it, with a couple of faint offset sheets behind it suggesting
      // more pages underneath.
      container.innerHTML =
        '<div id="dg-notes-panel">' +
        '<div class="dg-notes-tab-strip">' + tabsHtml + '</div>' +
        '<div class="dg-notes-folder-body">' +
        '<div class="dg-notes-paper">' +
        '<div class="dg-notes-paper-rules"></div>' +
        '<div class="dg-notes-paper-margin"></div>' +
        '<div class="dg-notes-holes"><div class="dg-notes-hole"></div><div class="dg-notes-hole"></div><div class="dg-notes-hole"></div></div>' +
        '<div class="dg-notes-paper-content">' +
        '<div class="dg-notes-toolbar">' + circulateBtnHtml + pinBtnHtml + tagBtnHtml + timelineBtnHtml +
        '<input type="search" class="dg-notes-search" placeholder="Search notes…" value="' + escapeHtml(searchTerm) + '">' +
        '<label class="dg-notes-toggle-label-inline"><input type="checkbox" class="dg-notes-search-everywhere"' + (searchEverywhere ? ' checked' : '') + '> Search everywhere</label>' +
        '<label class="dg-notes-toggle-label-inline"><input type="checkbox" class="dg-notes-plain-fonts"' + (plainFonts ? ' checked' : '') + '> Plain fonts</label>' +
        '</div>' +
        '<div class="dg-notes-body">' +
        '<aside class="dg-notes-toc"><div class="dg-notes-toc-label">Index</div><div id="dg-notes-toc-mount"></div>' +
        '<div id="dg-notes-evidence-mount"></div></aside>' +
        '<main class="dg-notes-main">' +
        bodyHtml +
        '</main></div>' +
        '</div></div></div></div>';

      wireShellEvents();
      if (isOwnTab) {
        mountEditor();
      } else {
        refreshReadOnlyFeed();
      }
      refreshToc();
      refreshEvidenceSidebar();
    }

    // Updates just the TOC and tab ink colors in place, without
    // touching the editor mount or the read-only feed's own content --
    // safe to call after every poll and every debounced save.
    function refreshChrome() {
      refreshToc();
      container.querySelectorAll('[data-tab]').forEach(btn => {
        const code = btn.dataset.tab;
        if (code === SHARED_TAB) return;
        const id = identityFor(code);
        if (id) btn.style.setProperty('--tab-ink', id.color);
      });
    }

    function tocItemHtml(b, label, fromLabel) {
      const id = identityFor(b.agent_code);
      const dot = id ? '<span class="dg-notes-toc-dot" style="background:' + id.color + '"></span>' : '';
      const lvlCls = Number(b.data && b.data.level) === 2 ? ' dg-notes-toc-h2' : '';
      const from = fromLabel ? '<span class="dg-notes-toc-from">' + escapeHtml(fromLabel) + '</span>' : '';
      return '<a href="#" class="dg-notes-toc-item' + lvlCls + '" data-scroll-to="' + escapeHtml(b.block_id) + '" data-owner="' + escapeHtml(b.agent_code) + '">' +
        dot + '<span class="dg-notes-toc-item-text">' + escapeHtml(label) + '</span>' + from + '</a>';
    }

    function refreshToc() {
      const mount = container.querySelector('#dg-notes-toc-mount');
      const label = container.querySelector('.dg-notes-toc-label');
      if (!mount) return;

      // Search everywhere replaces the normal Index with a combined
      // results list spanning every block actually visible to you --
      // your own (any privacy) plus everyone else's shared blocks,
      // i.e. exactly what's already visible somewhere, just normally
      // split across tabs. A private block belonging to someone else
      // was never even in notesByCode to begin with (server-side
      // filter), so there's nothing extra to guard against here.
      if (searchEverywhere && searchTerm) {
        if (label) label.textContent = 'Search Results';
        const hits = allVisibleBlocks()
          // evidence_remark blocks are reachable from the Evidence
          // sidebar/detail modal instead, not general note search.
          .filter(b => b.type !== 'evidence_remark' && (b.agent_code === agentCode || b.shared) && matchesSearch(b))
          .sort((a, b) => (a.created_at || a.updated_at || 0) - (b.created_at || b.updated_at || 0));
        mount.innerHTML = hits.length
          ? hits.map(b => {
            const snippet = (plainTextOf(b.type, b.data) || '(' + b.type + ')').slice(0, 60);
            const from = b.agent_code === agentCode ? 'your tab' : memberLabel(b.agent_code);
            return tocItemHtml(b, snippet, from);
          }).join('')
          : '<div class="dg-notes-toc-empty">No matches.</div>';
        wireTocEvents();
        return;
      }
      if (label) label.textContent = 'Index';

      // Scoped to whatever's actually on screen in the active tab --
      // the Shared tab's Index only lists shared blocks, not your own
      // private ones bleeding through from a tab you're not even
      // looking at. ("Search everywhere" above is the one intentional,
      // explicitly-opted-into exception to this, already returned by then.)
      const scopeBlocks = activeCode === SHARED_TAB ? sharedBlocksSorted() : (notesByCode[agentCode] || []);
      const pinnedBlocks = scopeBlocks.filter(b => b.pinned)
        .sort((a, b) => (a.created_at || a.updated_at || 0) - (b.created_at || b.updated_at || 0));
      const tocBlocks = scopeBlocks
        .filter(b => b.type === 'header')
        .sort((a, b) => (a.created_at || a.updated_at || 0) - (b.created_at || b.updated_at || 0));
      const pinnedHtml = pinnedBlocks.length
        ? '<div class="dg-notes-toc-subhead">Pinned</div>' + pinnedBlocks.map(b => tocItemHtml(b, plainTextOf(b.type, b.data) || '(' + b.type + ')')).join('')
        : '';
      const indexHtml = tocBlocks.length
        ? tocBlocks.map(b => tocItemHtml(b, plainTextOf('header', b.data) || '(untitled)')).join('')
        : '<div class="dg-notes-toc-empty">No headings yet.</div>';
      mount.innerHTML = pinnedHtml + indexHtml;
      wireTocEvents();
    }

    // Shared by the flat read-only feed and the grouped Timeline view
    // below -- one block's author/pin badges, tag chips, and rendered
    // content, identical either way.
    function renderRoBlock(b, showAuthor) {
      const authorBadge = showAuthor
        ? '<span class="dg-notes-author-badge" style="background:' + (identityFor(b.agent_code) ? identityFor(b.agent_code).color : '#4a5568') + '">' + escapeHtml(memberLabel(b.agent_code)) + '</span>'
        : '<span class="dg-notes-shared-badge">' + (b.shared ? 'Circulated' : 'Private') + '</span>';
      const pinBadge = b.pinned ? '<span class="dg-notes-pin-badge">Pinned</span>' : '';
      const tags = b.tags || [];
      const tagChips = tags.length
        ? '<div class="dg-notes-tag-chips">' + tags.map(t => '<span class="dg-notes-tag-chip dg-notes-tag-chip-' + escapeHtml(t.type) + '">' + escapeHtml(t.label) + '</span>').join('') + '</div>'
        : '';
      return '<div class="dg-notes-ro-block' + (b.pinned ? ' dg-notes-ro-block-pinned' : '') + '" id="block-' + escapeHtml(b.block_id) + '" style="' + inkStyleFor(b.agent_code) + '">' +
        authorBadge + pinBadge + renderReadOnlyBlock(b.type, b.data) + tagChips + '</div>';
    }

    // Pinned-first, otherwise unchanged relative order -- only for the
    // flat feed. Timeline view stays strictly chronological within each
    // date group (see renderTimelineGroups() above): reordering for
    // pins there would fight the "what happened when" point of
    // Timeline itself. Pin's own "always findable" value already comes
    // from the sidebar's Pinned section, which shows regardless of
    // which view mode you're in.
    function pinnedFirst(blocks) {
      return blocks.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    }

    // Regroups an already-chronologically-sorted block list into
    // date-headed sections ("Session -- Aug 20, 2026"). Only ever
    // called with sharedBlocksSorted()'s output, so blocks are already
    // in ascending created_at order -- a run of same-day blocks is
    // always contiguous, no separate sort/bucket-then-reorder needed.
    function renderTimelineGroups(blocks) {
      const groups = [];
      let current = null;
      blocks.forEach(b => {
        const ts = b.created_at || b.updated_at || 0;
        const label = ts
          ? new Date(ts).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
          : 'Undated';
        if (!current || current.label !== label) {
          current = { label, blocks: [] };
          groups.push(current);
        }
        current.blocks.push(b);
      });
      return groups.map(g =>
        '<div class="dg-notes-timeline-group">' +
        '<div class="dg-notes-timeline-date">' + escapeHtml(g.label) + '</div>' +
        g.blocks.map(b => renderRoBlock(b, true)).join('') +
        '</div>'
      ).join('');
    }

    // Only ever called for the combined Shared tab now -- your own tab
    // always mounts the live editor instead (see isOwnTab in render()),
    // and there's no other read-only tab left to render.
    function refreshReadOnlyFeed() {
      const mount = container.querySelector('#dg-notes-readonly-feed');
      if (!mount) return;
      const blocks = sharedBlocksSorted().filter(matchesSearch);
      const emptyLabel = searchTerm ? 'No shared blocks match your search.' : 'Nothing shared yet.';
      // This whole feed is read-only (see the file header comment for
      // why) -- without this, the Shared tab is a total dead end with
      // no controls at all, which read as "totally buggy, can't do
      // anything" the moment someone tapped over to look at it. Always
      // visible here, not just in the empty state, since it's the one
      // way off this tab into somewhere you can actually write.
      const composeHint = '<button type="button" class="dg-notes-goto-own-btn" data-goto-own="1">Write on your own tab, then tap Circulate to add it here &rarr;</button>';
      const bodyHtml = blocks.length
        ? (timelineMode ? renderTimelineGroups(blocks) : pinnedFirst(blocks).map(b => renderRoBlock(b, true)).join(''))
        : '<div class="dg-notes-empty">' + emptyLabel + '</div>';
      mount.innerHTML = composeHint + bodyHtml;
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
          refreshToc(); // Search Results (if searchEverywhere) lives in the sidebar
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
      const pinBtn = container.querySelector('.dg-notes-pin-btn');
      if (pinBtn) {
        pinBtn.addEventListener('click', () => {
          if (!currentBlockId) return;
          pinnedByBlockId[currentBlockId] = !pinnedByBlockId[currentBlockId];
          updatePinButton();
          scheduleSave(currentBlockId);
        });
      }
      const tagBtn = container.querySelector('.dg-notes-tag-btn');
      if (tagBtn) {
        tagBtn.addEventListener('click', () => {
          if (!currentBlockId) return;
          tagPopoverOpen = !tagPopoverOpen;
          refreshTagPopover();
        });
      }
      const timelineBtn = container.querySelector('.dg-notes-timeline-btn');
      if (timelineBtn) {
        timelineBtn.addEventListener('click', () => {
          timelineMode = !timelineMode;
          timelineBtn.classList.toggle('active', timelineMode);
          timelineBtn.textContent = timelineMode ? 'Flat view' : 'Group by date';
          refreshReadOnlyFeed();
        });
      }
      const searchEverywhereBox = container.querySelector('.dg-notes-search-everywhere');
      if (searchEverywhereBox) {
        searchEverywhereBox.addEventListener('change', () => {
          searchEverywhere = searchEverywhereBox.checked;
          refreshToc();
        });
      }
      const plainFontsBox = container.querySelector('.dg-notes-plain-fonts');
      if (plainFontsBox) {
        plainFontsBox.addEventListener('change', () => {
          plainFonts = plainFontsBox.checked;
          try { localStorage.setItem(PLAIN_FONTS_KEY, plainFonts ? '1' : '0'); } catch (e) { /* best effort */ }
          // Re-applies ink everywhere it currently shows -- your own
          // tab's editor mount (a no-op if you're not on it) and
          // whichever read-only feed is on screen (if any).
          applyOwnInkStyle();
          if (activeCode !== agentCode) refreshReadOnlyFeed();
        });
      }
    }
    function wireTocEvents() {
      container.querySelectorAll('[data-scroll-to]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          const blockId = a.dataset.scrollTo;
          const owner = a.dataset.owner;
          // No per-member tabs anymore -- anything not yours is
          // necessarily on the Shared tab (the only other place a
          // block belonging to someone else could ever be visible).
          const dest = owner === agentCode ? agentCode : SHARED_TAB;
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
    let popoverScrollLockObserver = null;
    let bodyOverflowBeforeLock = '';

    // Mobile Safari's block-type/settings popover is a position:fixed
    // bottom sheet (Editor.js's own CSS, see notes.css's big comment on
    // the .ce-popover__container media rule) -- those are notoriously
    // liable to render in the wrong place on iOS Safari if the page can
    // still scroll while the sheet is open (a long-documented WebKit
    // quirk: a position:fixed element inserted mid-scroll, or while the
    // visual/layout viewport disagree, gets pinned to a stale offset
    // instead of the real viewport). Freezing body scroll for exactly as
    // long as a popover is open is the standard fix every mobile sheet/
    // modal library uses for this. Editor.js toggles `.ce-popover--opened`
    // on the popover's own wrapper when it opens/closes -- a
    // MutationObserver on that class is the only hook available, since
    // Editor.js doesn't expose a popover-open/close event of its own.
    function lockBodyScrollWhilePopoverOpen(mount) {
      if (!mount || !window.MutationObserver) return;
      const sync = () => {
        const open = !!mount.querySelector('.ce-popover--opened');
        if (open && document.body.style.overflow !== 'hidden') {
          bodyOverflowBeforeLock = document.body.style.overflow;
          document.body.style.overflow = 'hidden';
        } else if (!open && document.body.style.overflow === 'hidden') {
          document.body.style.overflow = bodyOverflowBeforeLock;
        }
      };
      popoverScrollLockObserver = new MutationObserver(sync);
      popoverScrollLockObserver.observe(mount, { attributes: true, attributeFilter: ['class'], subtree: true });
    }
    function unlockBodyScrollForPopover() {
      if (popoverScrollLockObserver) { popoverScrollLockObserver.disconnect(); popoverScrollLockObserver = null; }
      if (document.body.style.overflow === 'hidden') document.body.style.overflow = bodyOverflowBeforeLock;
    }

    function updateCirculateButton() {
      const btn = container.querySelector('.dg-notes-circulate-btn');
      if (!btn) return;
      const known = !!currentBlockId;
      btn.disabled = !known;
      btn.classList.toggle('active', known && !!sharedByBlockId[currentBlockId]);
      btn.title = known ? 'Circulate this block to the whole Cell' : 'Click into a block first';
    }

    function updatePinButton() {
      const btn = container.querySelector('.dg-notes-pin-btn');
      if (!btn) return;
      const known = !!currentBlockId;
      btn.disabled = !known;
      btn.classList.toggle('active', known && !!pinnedByBlockId[currentBlockId]);
      btn.title = known ? 'Pin this block to the top of the Index' : 'Click into a block first';
    }

    function updateTagButton() {
      const btn = container.querySelector('.dg-notes-tag-btn');
      if (!btn) return;
      const known = !!currentBlockId;
      btn.disabled = !known;
      if (!known) tagPopoverOpen = false;
      const tags = known ? (tagsByBlockId[currentBlockId] || []) : [];
      btn.classList.toggle('active', known && tags.length > 0);
      btn.title = known ? 'Tag NPCs, locations, or clues in this block' : 'Click into a block first';
      refreshTagPopover();
    }

    // Popover content for the block your cursor is currently in --
    // three type chips (NPC/Location/Clue) plus a text field to add a
    // tag of that type, and the block's already-added tags as
    // removable chips. Rebuilt (not just shown/hidden) on every open
    // and every add/remove, same "small hand-rendered surface, no
    // framework" approach as the rest of this file.
    function refreshTagPopover() {
      const pop = container.querySelector('#dg-notes-tag-popover');
      if (!pop) return;
      if (!tagPopoverOpen || !currentBlockId) { pop.hidden = true; return; }
      pop.hidden = false;
      const tags = tagsByBlockId[currentBlockId] || [];
      pop.innerHTML =
        '<div class="dg-notes-tag-types">' +
        TAG_TYPES.map(t => '<button type="button" class="dg-notes-tag-type-chip' + (t.id === tagPopoverType ? ' selected' : '') + '" data-type="' + t.id + '">' + t.label + '</button>').join('') +
        '</div>' +
        '<div class="dg-notes-tag-add-row">' +
        '<input type="text" class="dg-notes-tag-input" placeholder="Name…">' +
        '<button type="button" class="dg-notes-tag-add-btn">Add</button>' +
        '</div>' +
        '<div class="dg-notes-tag-current">' +
        (tags.length
          ? tags.map((t, i) => '<span class="dg-notes-tag-chip dg-notes-tag-chip-' + escapeHtml(t.type) + '">' + escapeHtml(t.label) + '<button type="button" class="dg-notes-tag-remove" data-idx="' + i + '">&times;</button></span>').join('')
          : '<span class="dg-notes-tag-current-empty">No tags on this block yet.</span>') +
        '</div>';
      pop.querySelectorAll('[data-type]').forEach(btn => {
        btn.addEventListener('click', () => { tagPopoverType = btn.dataset.type; refreshTagPopover(); });
      });
      const addBtn = pop.querySelector('.dg-notes-tag-add-btn');
      const input = pop.querySelector('.dg-notes-tag-input');
      function commitAdd() {
        const label = (input.value || '').trim();
        if (!label || !currentBlockId) return;
        const list = tagsByBlockId[currentBlockId] || (tagsByBlockId[currentBlockId] = []);
        list.push({ type: tagPopoverType, label });
        scheduleSave(currentBlockId);
        refreshTagPopover();
        updateTagButtonActiveOnly();
      }
      addBtn.addEventListener('click', commitAdd);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); commitAdd(); } });
      pop.querySelectorAll('.dg-notes-tag-remove').forEach(btn => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.idx);
          const list = tagsByBlockId[currentBlockId] || [];
          list.splice(idx, 1);
          scheduleSave(currentBlockId);
          refreshTagPopover();
          updateTagButtonActiveOnly();
        });
      });
    }
    // A trimmed version of updateTagButton() that only refreshes the
    // button's active/disabled state, not the popover it would
    // otherwise recurse into rebuilding mid-interaction (refreshTagPopover()
    // itself calls this after every add/remove).
    function updateTagButtonActiveOnly() {
      const btn = container.querySelector('.dg-notes-tag-btn');
      if (!btn || !currentBlockId) return;
      const tags = tagsByBlockId[currentBlockId] || [];
      btn.classList.toggle('active', tags.length > 0);
    }

    function mountEditor() {
      if (editorInstance) return; // never remounted while already live (a poll must not trigger this)
      currentBlockId = null;
      tagPopoverOpen = false;
      const initialBlocks = (notesByCode[agentCode] || []).slice()
        // evidence_remark blocks (see the Evidence sidebar/detail view
        // further down) reuse this same CellNotes table but aren't a
        // tool Editor.js has registered -- keep them out of the live
        // document entirely, they're rendered only in the Evidence
        // detail modal.
        .filter(b => b.type !== 'evidence_remark')
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(b => {
          sharedByBlockId[b.block_id] = !!b.shared;
          pinnedByBlockId[b.block_id] = !!b.pinned;
          tagsByBlockId[b.block_id] = b.tags || [];
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
            updatePinButton();
            updateTagButton();
          });
          lockBodyScrollWhilePopoverOpen(mount);
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
      unlockBodyScrollForPopover();
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
      const pinned = !!pinnedByBlockId[blockId];
      const tags = tagsByBlockId[blockId] || [];
      const meta = upsertLocalMeta(agentCode, blockId, { type: b.type, data: b.data, shared, pinned, tags, sort_order: idx * 1000 });
      postAction({
        action: 'save_note_block', block_id: blockId, cell_id: cellId, agent_code: agentCode, token: agentToken,
        block_type: b.type, text: JSON.stringify(b.data), shared, pinned, tags: JSON.stringify(tags), sort_order: meta.sort_order,
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
      delete pinnedByBlockId[blockId];
      delete tagsByBlockId[blockId];
      clearTimeout(saveTimers[blockId]);
      postAction({ action: 'delete_note_block', block_id: blockId, cell_id: cellId, agent_code: agentCode, token: agentToken }).catch(() => { });
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
    // mountEditor() necessarily mounts your own tab's live editor
    // BEFORE the first fetchNotes() has ever resolved (render() runs
    // synchronously in init(), fetchNotes() is async) -- so the very
    // first time it mounts, it's always empty, regardless of whatever
    // you'd already saved in a previous session. Tracks whether that
    // first fetch has landed yet, so fetchNotes() below can tell "the
    // editor is empty because nothing's loaded yet" apart from "the
    // editor already has your real, possibly-just-typed content."
    let ownDataLoaded = false;

    function fetchNotes() {
      if (!cellId) return;
      jsonpGet('list_cell_notes', { cell_id: cellId, agent_code: agentCode, token: agentToken }, res => {
        if (!res || res.status !== 'OK') return;
        const incoming = res.notes || {};
        const parsed = {};
        Object.keys(incoming).forEach(code => {
          parsed[code] = (incoming[code] || []).map(row => {
            const b = parseStoredBlock(row.block_type, row.text);
            let tags = [];
            try { tags = JSON.parse(row.tags || '[]'); } catch (e) { tags = []; }
            return {
              block_id: row.block_id, agent_code: row.agent_code, type: b.type, data: b.data,
              shared: !!row.shared, pinned: !!row.pinned, tags: tags,
              sort_order: row.sort_order, created_at: row.created_at, updated_at: row.updated_at,
            };
          });
        });
        const isFirstLoad = !ownDataLoaded;
        ownDataLoaded = true;
        // Your own tab's live document is the source of truth once
        // it's actually holding your real data -- don't let a LATER
        // poll's (possibly-lagging) echo of your own writes overwrite
        // notesByCode[agentCode] out from under the editor's own
        // bookkeeping. The very first fetch is different: the editor
        // was necessarily mounted empty (see ownDataLoaded's own
        // comment above), so this one time the server's copy IS what
        // needs to end up on screen -- skipping it here silently made
        // every previously-saved note vanish from its own author's
        // view the moment they reopened Notes (still safe server-side,
        // and still visible to every other Cell member's own client,
        // just gone from the one screen a returning player actually
        // looks at, effectively a false "did I lose everything?" scare).
        if (!isFirstLoad && activeCode === agentCode && editorInstance) delete parsed[agentCode];
        Object.assign(notesByCode, parsed);
        identities = res.identities || identities;
        if (isFirstLoad && activeCode === agentCode && editorInstance) loadOwnBlocksIntoEditor();
        refreshChrome();
        if (activeCode !== agentCode) refreshReadOnlyFeed();
      });
    }

    // Pushes your own just-fetched blocks into the live editor -- only
    // ever needed once, right after the first fetchNotes() resolves
    // (see its call site's comment for why). A narrow, accepted race:
    // if you'd already started typing a brand-new block in the second
    // or two before this fetch resolved, that in-progress block gets
    // replaced along with everything else -- same trade-off class as
    // every other fire-and-forget write in this app already accepts,
    // and far narrower than the bug this fixes.
    function loadOwnBlocksIntoEditor() {
      if (!editorInstance) return;
      const initialBlocks = (notesByCode[agentCode] || []).slice()
        .filter(b => b.type !== 'evidence_remark') // see mountEditor()'s own filter for why
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(b => {
          sharedByBlockId[b.block_id] = !!b.shared;
          pinnedByBlockId[b.block_id] = !!b.pinned;
          tagsByBlockId[b.block_id] = b.tags || [];
          return { id: b.block_id, type: b.type, data: b.data };
        });
      if (!initialBlocks.length) return;
      // .blocks (and every other public API method) isn't attached to
      // the instance until Editor.js's own internal async init
      // finishes -- calling .blocks.render() right after `new
      // EditorJS(...)` returns, with no wait, hits it while still
      // undefined, since this can run as early as the very first
      // fetchNotes() resolving, which races ahead of Editor.js's own
      // readiness in practice. isReady is Editor.js's own documented
      // signal for this.
      const inst = editorInstance;
      inst.isReady.then(() => {
        if (editorInstance !== inst) return; // tab switched away/unmounted before this resolved
        inst.blocks.render({ blocks: initialBlocks });
      });
    }

    function pollTick_() {
      fetchNotes();
      fetchEvidence();
    }
    function scheduleNextPoll_() {
      pollTimer = setTimeout(function () {
        pollTick_();
        scheduleNextPoll_();
      }, POLL_MS + Math.floor(Math.random() * POLL_JITTER_MS));
    }
    function startPolling() {
      stopPolling();
      scheduleNextPoll_();
    }
    function stopPolling() {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
    }

    render();
    pollTick_();
    startPolling();

    return {
      refresh: pollTick_,
      destroy: () => { stopPolling(); closeEvidenceModal(); unmountEditor(); },
    };
  }

  window.dgNotesPanel = { init };
})();
