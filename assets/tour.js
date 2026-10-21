/* Player tours of the new features (v3.8.0), loaded by assets/field-notes.js
   on every player page.

   A tour is a few yellow post-its (the SAN-loss post-it's look) over the
   dimmed page; the thing explained stays lit inside a dashed frame and a
   red hand-drawn arrow points at it. Each tour starts by itself the first
   time its place is on screen (one a page load, never over another
   window), and runs once per device. It can be left at any moment:
   ✕ Exit tour on every post-it, Esc, or a tap on the dimmed page. A
   "New · N tours" stamp on the notebook lists the ones not seen yet, and
   the notebook's Settings → Tours replays any of them.

   A step's target can sit inside the notebook's Notes page (an iframe):
   its frame is found and the target's box translated, scale included. A
   step whose target isn't on this screen (Split on a phone, a Handler's
   label that hasn't been given) is skipped. */
(function () {
  if (window.dgTour) return;
  var SEEN_KEY = 'dg_tours_seen', PENDING_KEY = 'dg_tour_pending';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  function seen() { try { return JSON.parse(lsGet(SEEN_KEY) || '{}') || {}; } catch (e) { return {}; } }
  function markSeen(id) { var s = seen(); s[id] = Date.now(); lsSet(SEEN_KEY, JSON.stringify(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function FN() { return window.dgFieldNotes && window.dgFieldNotes.isHost ? window.dgFieldNotes : null; }
  function nbOpen() { var f = FN(); return !!(f && f.isOpen && f.isOpen()); }
  function nbView() { var f = FN(); return f && f.view ? f.view() : ''; }
  // The Hub shell (hub.html) shows the pages in a frame: what the player
  // looks at is that frame's page, and the buttons are in it.
  function shellDoc() {
    var f = document.getElementById('dg-shell-content');
    if (!f) return null;
    try { return f.contentDocument && f.contentDocument.body ? f.contentDocument : null; } catch (e) { return null; }
  }
  function page() {
    var d = shellDoc(), loc = location;
    if (document.getElementById('dg-shell-content')) {
      if (!d) return '';
      loc = d.defaultView.location;
    }
    return (loc.pathname.split('/').pop() || 'index.html').toLowerCase();
  }
  function go(path) { var f = FN(); if (f && f.go) f.go(path); else location.href = path; }

  // The notebook's Notes page, when it's showing in the notebook.
  function notesFrame() {
    var ifr = Array.prototype.filter.call(document.querySelectorAll('iframe[data-dg-embed="notes"]'), shown)[0];
    if (!ifr) return null;
    try { return ifr.contentDocument ? ifr : null; } catch (e) { return null; }
  }
  function shown(el) {
    if (!el || !el.getClientRects().length) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var cs = el.ownerDocument.defaultView.getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  }
  // A step's element: in this page, or in the Notes frame ({frame:true}).
  function find(step) {
    var sels = [].concat(step.sel);
    // With the notebook open, only what's in it: the page underneath has
    // the same Agent File buttons, covered by the notebook.
    var inNb = nbOpen();
    for (var i = 0; i < sels.length; i++) {
      if (step.frame) {
        var f = notesFrame(), fe = f && f.contentDocument.querySelector(sels[i]);
        if (fe && shown(fe)) return fe;
        continue;
      }
      var all = document.querySelectorAll(sels[i]);
      for (var k = 0; k < all.length; k++) {
        if (!!all[k].closest('#fn-veil') !== inNb) continue;
        if (shown(all[k])) return all[k];
      }
      var sd = !inNb && shellDoc();
      if (sd) {
        var se = Array.prototype.filter.call(sd.querySelectorAll(sels[i]), shown)[0];
        if (se) return se;
      }
    }
    return null;
  }
  function rectOf(el) {
    var r = el.getBoundingClientRect();
    if (el.ownerDocument === document) return r;
    var ifr = el.ownerDocument.defaultView.frameElement;
    if (!ifr) return r;
    var fr = ifr.getBoundingClientRect(), s = ifr.offsetWidth ? fr.width / ifr.offsetWidth : 1;
    return { left: fr.left + r.left * s, top: fr.top + r.top * s, width: r.width * s, height: r.height * s,
             right: fr.left + r.right * s, bottom: fr.top + r.bottom * s };
  }
  function any(sel, frame) { return !!find({ sel: sel, frame: frame }); }

  // Another window is up: no tour starts over it.
  function blocked() {
    if (document.getElementById('dg-tour')) return true;
    var b = ['#ap-posts', '#fn-orders', '.dg-ev-viewer', '.dg-notes-identity-modal', '#boot-splash:not(.boot-hidden)', '.evidence-lightbox', '.ah-handout-lightbox',
      '#dg-shell-loading:not(.dg-shell-loading-hidden)'];
    var f = notesFrame(), docs = [document, f && f.contentDocument, shellDoc()];
    for (var i = 0; i < b.length; i++) {
      for (var j = 0; j < docs.length; j++) {
        if (docs[j] && Array.prototype.some.call(docs[j].querySelectorAll(b[i]), shown)) return true;
      }
    }
    // The shell's page still loading.
    if (document.getElementById('dg-shell-content') && !shellDoc()) return true;
    return false;
  }

  /* ── The tours ── */
  var TOURS = [
    { id: 'newrecruit', title: 'New Recruit', where: 'Agent Hub',
      when: function () { return page() === 'agent-hub.html' && !nbOpen(); },
      open: function () { if (page() !== 'agent-hub.html') { go('agent-hub.html?tour=newrecruit'); return true; } },
      steps: [
        { sel: '#tab-strip .tw-new', title: 'New Recruit', text: 'Your new Agents start here. The tab walks you through it step by step: statistics, profession, skills, Bonds and the rest, then the Oath.' },
        { sel: '#tab-strip .tw-new', title: 'Bring one in', text: 'Already have an Agent somewhere else? The first step also imports one: a PDF, a Foundry or Kappa Black file, a Google Sheet, or a Friendly from the one-shot page.' }
      ] },
    { id: 'photos', title: 'Taking a photo', where: 'Agent Hub, an Agent\'s folder',
      empty: 'Open one of your Agents on Agent Hub and this tour starts there.',
      when: function () { return page() === 'agent-hub.html' && !nbOpen() && any('.ah-appear-btn[data-ah-appear]'); },
      open: function () { if (page() !== 'agent-hub.html') { go('agent-hub.html?tour=photos'); return true; } },
      steps: [
        { sel: ['.paper-photo', '.as-take-photo'], title: 'The photo', text: 'Your Agent\'s photo. Your Handler makes it from how you describe the Agent, so the description is what counts.' },
        { sel: '[data-ah-focus="appearance"]', optional: true, title: 'Describe them', text: 'This shows how many details are still missing. Tap Describe them to fill them in.' },
        { sel: '.ah-appear-btn[data-ah-appear]', title: 'Appearance', text: 'The full profile: build, face, hair, clothes, marks. Pick from the lists or roll them, then Update Brief to save. The photo prompt is made from this.' },
        { sel: '.ah-appear-btn[data-ah-era]', title: 'Era photos', text: 'The same Agent in other decades, a photo per era, if your operation jumps in time.' }
      ] },
    { id: 'friendly', title: 'A Friendly as your Agent', where: 'Friendly, an opened dossier',
      when: function () { return page() === 'friendly.html' && !nbOpen() && any('#fr-keep'); },
      open: function () { if (page() !== 'friendly.html') { go('friendly.html?tour=friendly'); return true; } },
      empty: 'Open any dossier on the Friendly page and this tour starts there.',
      steps: [
        { sel: '#fr-keep', title: 'Make this my Agent', text: 'Liked playing this one? This opens New Recruit on Agent Hub with the Friendly already filled in, saved under your Cover Identity. You check each step and take the Oath.' }
      ] },
    { id: 'agentfile', title: 'Playing from the Agent File', where: 'the Agent File',
      when: function () { return any('.as-paper .as-stats') && any('[data-a="edit"]') && (nbOpen() ? nbView() === 'agentfile' : page() === 'agent-hub.html'); },
      open: function () { var f = FN(); if (f) f.open('agentfile'); },
      steps: [
        { sel: '.as-stats', title: 'Tap to roll', text: 'Tap a statistic to roll it ×5, or any skill below. The roll shows in the Dice Roller and your Cell sees it.' },
        { sel: '.ap-skillbar', title: 'Failed rolls', text: 'A failed skill roll turns the skill red. At the end of a session, Roll improvements adds 1D4 to each one, then clears them.' },
        { sel: '[data-a="edit"]', title: 'Edit', text: 'Changing the Agent itself (statistics, skills, name, Bonds) is in Edit. Saving asks for the Oath again.' },
        { sel: ['.ah-appear-btn[data-ah-cell]', '[data-p="cell"]'], optional: true, title: 'Your Cell', text: 'Your Cell in initiative order, highest DEX first. Tap a member to see their card.' }
      ] },
    { id: 'sanity', title: 'Sanity', where: 'the Agent File',
      when: function () { return any('[data-pop="san"]') && (nbOpen() ? nbView() === 'agentfile' : page() === 'agent-hub.html'); },
      open: function () { var f = FN(); if (f) f.open('agentfile'); },
      steps: [
        { sel: '[data-a="rollsan"]', title: 'Roll SAN', text: 'The plain SAN test when the Handler calls for one. What it costs is the Handler\'s call.' },
        { sel: '[data-pop="san"]', title: 'SAN loss', text: 'When the Handler announces a loss, tap here. Pick the amount (a number or dice) and the kind: Violence, Helplessness or Unnatural. It\'s rolled for you and your SAN drops.' },
        { sel: '[data-pop="san"]', title: 'What follows', text: 'Post-its tell you what happened: a disorder that triggers, temporary insanity at 5 or more, or your Breaking Point, where you choose a new disorder.' },
        { sel: '[data-pop="inc"]', optional: true, title: 'Adaptation', text: 'Losses to Violence or Helplessness tick these boxes. Three ticks and the Agent adapts, at a cost.' },
        { sel: '[data-pop="dis"]', optional: true, title: 'Mental Disorders', text: 'Add a disorder from the list (or in your own words). Its description stays on the file.' }
      ] },
    { id: 'switch', title: 'Switching Agents', where: 'the notebook',
      when: function () { return nbOpen() && any('[data-fn="flip-next"]'); },
      open: function () { var f = FN(); if (f) f.open('agentfile'); },
      empty: 'The switch appears when this device has two or more Agents.',
      steps: [
        { sel: ['[data-fn-slot="flip"]', '[data-fn-slot="phone-flip"]'], title: 'Your Agents', text: 'Several Agents on this device? Flip between them here (or swipe the Agent card). The whole notebook follows: Agent File, Notes, Evidence.' }
      ] },
    { id: 'notes', title: 'Notes', where: 'the notebook\'s Notes',
      when: function () { return nbOpen() && nbView() === 'notes'; },
      // The Notes page loads in its frame after the notebook opens.
      ready: function () { return any('#dg-notes-tags-mount', true) || any('#fn-veil [data-q="text"]'); },
      open: function () { var f = FN(); if (f) f.open('notes'); },
      steps: [
        { sel: '#fn-veil .fn-tab-split', title: 'Split', text: 'The Agent File on the left page, Notes (or any tab) on the right: roll and write at the same time. Tap Split again to go back.' },
        { sel: '#dg-notes-editor-mount', frame: true, title: 'Tag by highlighting', text: 'Highlight words in your note and pick NPC, Location, Clue or Operation. They\'re marked in the note and listed under Tags.' },
        { sel: '#dg-notes-tags-mount', frame: true, title: 'Tags', text: 'Every tag with a count. Tap one to see only the notes that carry it; tap it again to show them all.' },
        { sel: '.dg-notes-circulate-btn', frame: true, title: 'Circulate', text: 'Shares the note you\'re in with your Cell (the Shared tab). Off keeps it to you.' },
        { sel: '.dg-notes-pin-btn', frame: true, optional: true, title: 'Pin', text: 'Keeps a note at the top of your Index.' },
        { sel: '#dg-notes-quick-mount', frame: true, title: 'Quick notes', text: 'Notes you jot from the notebook on a phone wait here. Add to page puts one where your cursor is.' },
        { sel: '[data-arrange]', frame: true, title: 'Arrange', text: 'Show, hide and order these lists, on this device.' },
        { sel: '#fn-veil [data-q="text"]', title: 'Quick note', text: 'Jot something down fast. It waits in your full Notes until you add it to the page.' },
        { sel: '#fn-veil [data-q="tag"]', optional: true, title: 'Tag it', text: 'Tag a quick note as you write it. It keeps the tag when it\'s added to the page.' },
        { sel: '#fn-veil [data-q="shared"]', optional: true, title: 'Share it', text: 'Shares this note with your Cell.' }
      ] },
    { id: 'evidence', title: 'Evidence', where: 'the notebook\'s Evidences, or Agent Hub',
      empty: 'This tour starts once your Agent has Evidence filed: open Evidences in the notebook then.',
      when: function () { return any('.dg-gv-switch') && (nbOpen() ? nbView() === 'evidence' : page() === 'agent-hub.html'); },
      open: function () { var f = FN(); if (f) f.open('evidence'); },
      steps: [
        { sel: ['#fn-veil [data-ev-filter]', 'select[data-op-filter-code]'], optional: true, title: 'Operation', text: 'Only the Evidence of one Operation, or all of it.' },
        { sel: ['#fn-veil .dg-gv-switch', '.ah-handouts-view .dg-gv-switch'], title: 'Gallery', text: 'See your Evidence as a pinboard. Tap a picture to open it; Back returns to the board. Your choice is kept on this device.' },
        { sel: ['#fn-veil .dg-et', '.ah-handouts .dg-et'], optional: true, title: 'Your own tags', text: 'Type a tag and press Enter, × to remove it. Only you see them.' },
        { sel: ['#fn-veil .dg-et-h', '.ah-handouts .dg-et-h'], optional: true, title: 'Handler\'s labels', text: 'Red stamps are your Handler\'s labels. Everyone sees them.' },
        { sel: ['#fn-veil [data-et-filter]', '.ah-handouts-filter [data-et-filter]'], optional: true, title: 'Tags filter', text: 'Show only what carries a tag: yours or the Handler\'s. The gallery follows it too.' }
      ] },
    { id: 'settings', title: 'Settings', where: 'the notebook\'s Settings',
      when: function () { return nbOpen() && nbView() === 'settings'; },
      open: function () { var f = FN(); if (f) f.open('settings'); },
      steps: [
        { sel: '#fn-veil [data-s="paper-look"]', title: 'Agent File look', text: 'How the Agent File\'s parts are headed: Typed form, Folder tabs or Rubber stamps. On this device only.' },
        { sel: '#fn-veil [data-s="pdf"]', optional: true, title: 'Export', text: 'Your Agent as a DD Form 315 PDF, to keep or print.' },
        { sel: '#fn-veil [data-s="tours"]', title: 'Tours', text: 'Any of these tours again, whenever you like.' }
      ] }
  ];
  function tourById(id) { return TOURS.filter(function (t) { return t.id === id; })[0]; }

  /* ── Showing one ── */
  var cur = null; // {tour, i, auto}
  function css() {
    if (document.getElementById('dg-tour-css')) return;
    var st = document.createElement('style');
    st.id = 'dg-tour-css';
    st.textContent =
      '#dg-tour{position:fixed;inset:0;z-index:2147483000}' +
      '.dg-tour-dim{position:fixed;inset:0;cursor:pointer}' +
      '.dg-tour-hole{position:fixed;border-radius:4px;box-shadow:0 0 0 200vmax rgba(10,8,4,.58);outline:2px dashed rgba(246,233,138,.95);outline-offset:3px;pointer-events:none;transition:all .18s}' +
      '.dg-tour-post{position:fixed;width:330px;max-width:calc(100vw - 24px);box-sizing:border-box;padding:12px 16px 12px;background:#f6e98a;color:#3a2a04;' +
        'box-shadow:0 10px 22px rgba(60,40,0,.36),inset 0 -10px 16px rgba(120,100,20,.14);transform:rotate(-1.2deg);font:13px/1.5 "Courier Prime",monospace;text-align:left}' +
      '.dg-tour-post::before{content:"";position:absolute;top:-10px;left:50%;width:70px;height:20px;margin-left:-35px;background:rgba(235,226,196,.8);transform:rotate(2deg);box-shadow:0 1px 2px rgba(0,0,0,.15)}' +
      '.dg-tour-top{display:flex;align-items:center;justify-content:space-between;gap:8px;font:10px "Courier Prime",monospace;letter-spacing:.14em;text-transform:uppercase;color:rgba(58,42,4,.7);margin-bottom:6px}' +
      '.dg-tour-exit{font:10.5px "Special Elite",monospace;letter-spacing:.1em;text-transform:uppercase;color:#8b1f17;background:rgba(255,255,255,.45);border:1.5px solid #8b1f17;padding:3px 8px;cursor:pointer;flex:none}' +
      '.dg-tour-t{display:block;font:17px "Special Elite",monospace;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}' +
      '.dg-tour-pa{display:flex;gap:6px;margin-top:10px;align-items:center}' +
      '.dg-tour-pa button{font:12px "Special Elite",monospace;padding:5px 12px;border:1px solid rgba(58,42,4,.45);background:rgba(255,255,255,.4);color:#3a2a04;cursor:pointer}' +
      '.dg-tour-pa button[disabled]{opacity:.35;cursor:default}' +
      '.dg-tour-pa .dg-tour-next{margin-left:auto;background:#3a2a04;color:#f6e98a}' +
      '.dg-tour-dots{display:flex;gap:4px}.dg-tour-dots i{width:6px;height:6px;border-radius:50%;background:rgba(58,42,4,.25)}.dg-tour-dots i.on{background:#8b1f17}' +
      '#dg-tour svg{position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;overflow:visible}' +
      '.dg-tour-list{list-style:none;margin:8px 0 0;padding:0}.dg-tour-list li{display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px dashed rgba(58,42,4,.3)}' +
      '.dg-tour-list span{flex:1}.dg-tour-list small{display:block;font-size:10.5px;opacity:.7}.dg-tour-list em{font-style:normal;color:#2f6a3a;font-size:11px}' +
      '.dg-tour-list button{font:11px "Special Elite",monospace;padding:3px 9px;border:1px solid rgba(58,42,4,.45);background:rgba(255,255,255,.4);color:#3a2a04;cursor:pointer}' +
      '.dg-tour-new{position:fixed;z-index:2147482990;font:11.5px "Special Elite",monospace;letter-spacing:.14em;text-transform:uppercase;color:#c0392b;border:2.5px solid #c0392b;' +
        'padding:3px 8px;transform:rotate(-8deg);background:rgba(246,241,227,.94);box-shadow:0 2px 6px rgba(0,0,0,.4);cursor:pointer}';
    document.head.appendChild(st);
  }
  function layer() {
    css();
    var w = document.getElementById('dg-tour');
    if (!w) {
      w = document.createElement('div');
      w.id = 'dg-tour';
      w.setAttribute('role', 'dialog');
      w.setAttribute('aria-modal', 'true');
      document.body.appendChild(w);
    }
    return w;
  }
  function steps(t) {
    if (t.ready && !t.ready()) return [];
    return t.steps.filter(function (s) { return !!find(s); });
  }
  function end(markAsSeen) {
    if (cur && markAsSeen) markSeen(cur.tour.id);
    if (cur) clearInterval(cur.timer);
    cur = null;
    var w = document.getElementById('dg-tour');
    if (w) w.remove();
    window.removeEventListener('resize', place, true);
    window.removeEventListener('scroll', place, true);
    stamp();
  }
  function start(id, opts) {
    var t = tourById(id);
    if (!t || cur) return false;
    var list = steps(t);
    if (!list.length) return false;
    cur = { tour: t, list: list, i: 0, auto: !!(opts && opts.auto) };
    // The frame follows its target: a page that scrolls smoothly, or
    // redraws, moves it after the post-it is up.
    cur.timer = setInterval(place, 200);
    try { sessionStorage.removeItem(PENDING_KEY); } catch (e) { /* private mode */ }
    window.addEventListener('resize', place, true);
    window.addEventListener('scroll', place, true);
    show();
    return true;
  }
  function show() {
    var w = layer(), t = cur.tour, list = cur.list, s = list[cur.i], n = list.length;
    var el = find(s);
    if (el) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) { el.scrollIntoView(); }
    }
    w.innerHTML = '<div class="dg-tour-dim" data-tour="exit" title="Exit the tour"></div><div class="dg-tour-hole"></div>' +
      '<div class="dg-tour-post" role="document"><div class="dg-tour-top"><span>Tour · ' + esc(t.title) + ' &nbsp; ' + (cur.i + 1) + '/' + n + '</span>' +
      '<button type="button" class="dg-tour-exit" data-tour="exit">✕ Exit tour</button></div>' +
      '<span class="dg-tour-t">' + esc(s.title) + '</span>' + esc(s.text) +
      '<div class="dg-tour-pa"><button type="button" data-tour="back"' + (cur.i ? '' : ' disabled') + '>‹ Back</button><span class="dg-tour-dots">' +
      list.map(function (x, k) { return '<i' + (k === cur.i ? ' class="on"' : '') + '></i>'; }).join('') + '</span>' +
      '<button type="button" class="dg-tour-next" data-tour="next">' + (cur.i === n - 1 ? 'Done' : 'Next ›') + '</button></div></div><svg aria-hidden="true"></svg>';
    w.onclick = function (e) {
      var b = e.target.closest('[data-tour]');
      if (!b) return;
      var a = b.getAttribute('data-tour');
      if (a === 'exit') end(true);
      else if (a === 'back' && cur.i > 0) { cur.i--; show(); }
      else if (a === 'next') { if (cur.i < n - 1) { cur.i++; show(); } else end(true); }
    };
    place();
    var nx = w.querySelector('.dg-tour-next');
    if (nx) nx.focus();
  }
  // The frame, the post-it and the arrow, from where the target is now.
  function place() {
    if (!cur) return;
    var w = document.getElementById('dg-tour');
    if (!w) return;
    var el = find(cur.list[cur.i]), hole = w.querySelector('.dg-tour-hole'), post = w.querySelector('.dg-tour-post');
    if (!hole || !post) return;
    if (!el) {
      // Its target went away (the page redrew): no frame or arrow, the
      // post-it in the middle of the dimmed page; Exit and Next still work.
      hole.style.display = 'none';
      w.querySelector('svg').innerHTML = '';
      post.style.left = Math.max(12, innerWidth / 2 - post.offsetWidth / 2) + 'px';
      post.style.top = Math.max(12, innerHeight / 2 - post.offsetHeight / 2) + 'px';
      if (!w.querySelector('.dg-tour-dim-full')) w.insertAdjacentHTML('afterbegin', '<div class="dg-tour-dim-full" style="position:fixed;inset:0;background:rgba(10,8,4,.58);pointer-events:none"></div>');
      return;
    }
    var full = w.querySelector('.dg-tour-dim-full');
    if (full) full.remove();
    hole.style.display = '';
    var r = rectOf(el), pad = 7;
    hole.style.left = (r.left - pad) + 'px'; hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
    var W = innerWidth, H = innerHeight, pw = post.offsetWidth, ph = post.offsetHeight, gap = 44, x, y;
    if (r.bottom + gap + ph < H - 10) { x = r.left + r.width / 2 - pw / 2; y = r.bottom + gap; }
    else if (r.top - gap - ph > 10) { x = r.left + r.width / 2 - pw / 2; y = r.top - gap - ph; }
    else if (r.left - pw - gap > 10) { x = r.left - pw - gap; y = r.top + r.height / 2 - ph / 2; }
    else if (r.right + pw + gap < W - 10) { x = r.right + gap; y = r.top + r.height / 2 - ph / 2; }
    else { x = W / 2 - pw / 2; y = H - ph - 12; }
    x = Math.max(12, Math.min(W - pw - 12, x)); y = Math.max(12, Math.min(H - ph - 12, y));
    post.style.left = x + 'px'; post.style.top = y + 'px';
    var pc = { x: x + pw / 2, y: y + ph / 2 }, tc = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    function edge(cx, cy, ww, hh, tx, ty) {
      var dx = tx - cx, dy = ty - cy, s = Math.min(Math.abs((ww / 2) / (dx || 1e-6)), Math.abs((hh / 2) / (dy || 1e-6)));
      return { x: cx + dx * s, y: cy + dy * s };
    }
    var a = edge(pc.x, pc.y, pw + 8, ph + 8, tc.x, tc.y), b = edge(tc.x, tc.y, r.width + 22, r.height + 22, pc.x, pc.y);
    var svg = w.querySelector('svg');
    if (Math.hypot(b.x - a.x, b.y - a.y) < 18) { svg.innerHTML = ''; return; }
    var mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.22, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.22;
    var ang = Math.atan2(b.y - my, b.x - mx), L = 13;
    var h1 = { x: b.x - L * Math.cos(ang - 0.5), y: b.y - L * Math.sin(ang - 0.5) }, h2 = { x: b.x - L * Math.cos(ang + 0.5), y: b.y - L * Math.sin(ang + 0.5) };
    svg.innerHTML = '<g fill="none" stroke="#d2402f" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,.4))">' +
      '<path d="M' + a.x + ',' + a.y + ' Q' + mx + ',' + my + ' ' + b.x + ',' + b.y + '"/><path d="M' + h1.x + ',' + h1.y + ' L' + b.x + ',' + b.y + ' L' + h2.x + ',' + h2.y + '"/></g>';
  }
  // A single post-it, centred (the tour list, or why a tour can't run here).
  function note(title, html, isHtml) {
    if (cur) return;
    var w = layer();
    w.innerHTML = '<div class="dg-tour-dim" data-tour="close"></div><div class="dg-tour-post" style="left:50%;top:50%;transform:translate(-50%,-50%) rotate(-1.2deg)">' +
      '<div class="dg-tour-top"><span>Tours</span><button type="button" class="dg-tour-exit" data-tour="close">✕ Close</button></div>' +
      '<span class="dg-tour-t">' + esc(title) + '</span>' + (isHtml ? html : esc(html)) + '</div>';
    w.onclick = function (e) {
      var b = e.target.closest('[data-tour],[data-tour-start]');
      if (!b) return;
      if (b.hasAttribute('data-tour-start')) { w.remove(); run(b.getAttribute('data-tour-start')); return; }
      w.remove();
    };
  }
  function menu() {
    var s = seen();
    note('What\'s new', 'Short tours of the new features. Leave any of them whenever you like.<ul class="dg-tour-list">' + TOURS.map(function (t) {
      return '<li><span>' + esc(t.title) + '<small>' + esc(t.where) + '</small></span>' + (s[t.id] ? '<em>✓ seen</em>' : '') +
        '<button type="button" data-tour-start="' + t.id + '">' + (s[t.id] ? 'Again' : 'Start') + '</button></li>';
    }).join('') + '</ul>', true);
  }
  // From the list: go to the tour's place (opening the notebook's page, or
  // another page), then start it as soon as its first step is on screen.
  function run(id) {
    var t = tourById(id);
    if (!t) return;
    try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: id, at: Date.now() })); } catch (e) { /* private mode */ }
    var went = t.open ? t.open() === true : false;
    var tries = 0;
    (function wait() {
      if (cur) return;
      if (steps(t).length && !blocked()) { start(id, { fromMenu: true }); return; }
      if (++tries < (went ? 60 : 16)) { setTimeout(wait, 250); return; }
      if (went) return; // still loading: the pending mark starts it there
      // Still nothing here (another page is loading, or the place isn't
      // reachable from here): the pending mark picks it up on arrival.
      if (!/tour=/.test(location.search)) note(t.title, t.empty || ('This tour starts on ' + t.where + ', once it\'s on screen.'));
    })();
  }

  /* ── "New · N tours" on the notebook ── */
  function stamp() {
    var unseen = TOURS.filter(function (t) { return !seen()[t.id]; }).length;
    var host = document.querySelector('#fn-closed') && shown(document.querySelector('#fn-closed')) ? document.querySelector('#fn-closed')
      : (document.querySelector('#fn-closed-phone .fn-phone-book') && shown(document.querySelector('#fn-closed-phone .fn-phone-book')) ? document.querySelector('#fn-closed-phone .fn-phone-book') : null);
    var el = document.getElementById('dg-tour-new');
    if (!unseen || !host || nbOpen() || cur || off()) { if (el) el.remove(); return; }
    css();
    if (!el) {
      el = document.createElement('button');
      el.type = 'button'; el.id = 'dg-tour-new'; el.className = 'dg-tour-new';
      el.addEventListener('click', function (e) { e.stopPropagation(); menu(); });
      document.body.appendChild(el);
    }
    el.textContent = 'New · ' + unseen + (unseen === 1 ? ' tour' : ' tours');
    var r = host.getBoundingClientRect();
    el.style.left = Math.max(6, r.left - el.offsetWidth + 34) + 'px';
    el.style.top = Math.max(6, r.top - 12) + 'px';
  }

  /* ── Starting by themselves ── */
  var autoDone = false;
  // Off on this device (the test suite sets it): no tour starts by itself
  // and no stamp; Settings → Tours still works.
  // Nor where this device can't remember a seen tour (private mode, or
  // storage blocked): it would start again on every page.
  var canStore = (function () { try { localStorage.setItem('dg_tours_probe', '1'); localStorage.removeItem('dg_tours_probe'); return true; } catch (e) { return false; } })();
  function off() { return !canStore || lsGet('dg_tours_off') === '1'; }
  function tick() {
    if (off()) { var st = document.getElementById('dg-tour-new'); if (st) st.remove(); if (!pendingTour()) return; }
    else stamp();
    if (cur || blocked()) return;
    var pend = pendingTour();
    if (pend) {
      var pt = tourById(pend.id);
      if (pt && pt.when() && steps(pt).length) { start(pt.id, {}); return; }
    }
    if (autoDone || off()) return;
    var s = seen();
    for (var i = 0; i < TOURS.length; i++) {
      var t = TOURS[i];
      if (s[t.id]) continue;
      var ok = false;
      try { ok = t.when() && steps(t).length > 0; } catch (e) { ok = false; }
      if (ok) { autoDone = true; start(t.id, { auto: true }); return; }
    }
  }
  function pendingTour() {
    var pend = null;
    try { pend = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null'); } catch (e) { pend = null; }
    return pend && Date.now() - pend.at < 10 * 60 * 1000 ? pend : null;
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('dg-tour')) { e.stopPropagation(); e.preventDefault(); if (cur) end(true); else document.getElementById('dg-tour').remove(); }
  }, true);
  var m = /[?&]tour=([a-z]+)/.exec(location.search);
  if (m && tourById(m[1])) { try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: m[1], at: Date.now() })); } catch (e) { /* private mode */ } }
  setInterval(tick, 1200);
  setTimeout(tick, 600);

  window.dgTour = { menu: menu, run: run, start: start, exit: function () { end(true); }, tours: function () { return TOURS.map(function (t) { return t.id; }); },
    seen: seen, reset: function () { lsSet(SEEN_KEY, '{}'); autoDone = false; stamp(); }, active: function () { return cur ? cur.tour.id : ''; } };
})();
