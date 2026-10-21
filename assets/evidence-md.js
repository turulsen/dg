/* Evidence text formatting -- a small, safe Markdown subset (v3.6.0) --
   and the Evidence gallery (v3.7.0, window.dgEvidenceGallery, below).

   The Handler writes an Evidence item's text with A-Cell's toolbar:
     # Heading / ## Heading / ### Heading
     **bold**, *italic* (or _italic_)
     - bullet / * bullet, 1. numbered
     > quote
     --- (a rule)
   Every reader (A-Cell, the notebook's Evidences, Agent Hub, Notes)
   draws it with window.dgEvidenceMd.render(text), which escapes the text
   first, so nothing typed or pasted can inject HTML. Text written before
   v3.6.0 has none of these marks and reads as it always did: paragraphs
   and line breaks kept. */
(function () {
  if (window.dgEvidenceMd) return;

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // Bold before italic; a mark needs a non-space just inside it, so a
  // lone "*" or "2 * 3" is left alone.
  function inline(s) {
    return esc(s)
      .replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*\w])\*(?=\S)([^*]*?\S)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/(^|[^_\w])_(?=\S)([^_]*?\S)_(?![_\w])/g, '$1<i>$2</i>');
  }

  function render(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let para = [], list = null, quote = [];
    function flushPara() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    // A numbered list starts at the number written: "2. Step" after a
    // paragraph stays 2, not 1.
    function flushList() { if (list) { out.push('<' + list.tag + (list.start > 1 ? ' start="' + list.start + '"' : '') + '>' + list.items.map(function (x) { return '<li>' + inline(x) + '</li>'; }).join('') + '</' + list.tag + '>'); list = null; } }
    function flushQuote() { if (quote.length) { out.push('<blockquote>' + quote.map(inline).join('<br>') + '</blockquote>'); quote = []; } }
    function flush() { flushPara(); flushList(); flushQuote(); }
    lines.forEach(function (raw) {
      const line = raw.replace(/\s+$/, '');
      let m;
      if (!line.trim()) { flush(); return; }
      if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flush(); out.push('<h' + (m[1].length + 2) + '>' + inline(m[2]) + '</h' + (m[1].length + 2) + '>'); return; }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); out.push('<hr>'); return; }
      if ((m = /^\s*>\s?(.*)$/.exec(line))) { flushPara(); flushList(); quote.push(m[1]); return; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) {
        flushPara(); flushQuote();
        if (!list || list.tag !== 'ul') { flushList(); list = { tag: 'ul', items: [] }; }
        list.items.push(m[1]); return;
      }
      if ((m = /^\s*(\d+)[.)]\s+(.*)$/.exec(line))) {
        flushPara(); flushQuote();
        if (!list || list.tag !== 'ol') { flushList(); list = { tag: 'ol', items: [], start: parseInt(m[1], 10) }; }
        m[1] = m[2];
        list.items.push(m[1]); return;
      }
      flushList(); flushQuote();
      para.push(line);
    });
    flush();
    return out.join('');
  }

  // The look, the same wherever it's drawn: scoped to .dg-md, sized
  // relative to the reader's own body text.
  function injectStyles() {
    if (document.getElementById('dg-md-style')) return;
    const st = document.createElement('style');
    st.id = 'dg-md-style';
    st.textContent =
      '.dg-md{white-space:normal !important}' +
      '.dg-md>:first-child{margin-top:0}.dg-md>:last-child{margin-bottom:0}' +
      '.dg-md p{margin:0 0 .75em}' +
      '.dg-md h3,.dg-md h4,.dg-md h5{font-family:"Special Elite",monospace;font-weight:400;line-height:1.25;margin:.9em 0 .4em;color:inherit}' +
      '.dg-md h3{font-size:1.4em}.dg-md h4{font-size:1.2em}.dg-md h5{font-size:1.05em;letter-spacing:.04em;text-transform:uppercase}' +
      '.dg-md ul,.dg-md ol{margin:0 0 .75em;padding-left:1.4em}.dg-md li{margin:.15em 0}' +
      '.dg-md blockquote{margin:0 0 .75em;padding:.1em 0 .1em .8em;border-left:3px solid currentColor;opacity:.85;font-style:italic}' +
      '.dg-md hr{border:0;border-top:1px solid currentColor;opacity:.35;margin:1em 0}';
    (document.head || document.documentElement).appendChild(st);
  }
  injectStyles();

  window.dgEvidenceMd = { render: render, escape: esc };

  /* ── The Evidence gallery (v3.7.0): a pinboard of taped polaroids, the
     other way to look at a list of Evidence (A-Cell, Agent Hub, the
     notebook's Evidences, Notes). A photo shows the picture, a PDF a
     stamp, a text-only item its first lines on lined paper. The reader
     decides what a tap does; the List | Gallery choice is kept per
     device under its own key. ── */
  function plain(text) {
    return String(text || '').replace(/\r\n?/g, '\n')
      .replace(/^\s{0,3}(#{1,3}\s+|[-*•]\s+|\d+[.)]\s+|>\s?)/gm, '')
      .replace(/\*\*|__/g, '').replace(/(^|[\s(])[*_](?=\S)/g, '$1').replace(/(\S)[*_](?=[\s.,;:!?)]|$)/gm, '$1').replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
      .replace(/\s+/g, ' ').trim();
  }
  function isPdf(src) { return /^data:application\/pdf|\.pdf(\?|#|$)/i.test(String(src || '')); }
  function tilt(id) {
    let h = 0; String(id || '').split('').forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) | 0; });
    return ((Math.abs(h) % 7) - 3) * 0.55;
  }
  function getView(key) { try { return localStorage.getItem(key) === 'gallery' ? 'gallery' : 'list'; } catch (e) { return 'list'; } }
  function setView(key, v) { try { localStorage.setItem(key, v === 'gallery' ? 'gallery' : 'list'); } catch (e) { /* private mode */ } }
  function switchHtml(view) {
    return '<span class="dg-gv-switch" role="group" aria-label="View">' +
      ['list', 'gallery'].map(function (v) {
        return '<button type="button" data-gv-view="' + v + '" aria-pressed="' + (view === v) + '"' + (view === v ? ' class="on"' : '') + '>' + (v === 'list' ? 'List' : 'Gallery') + '</button>';
      }).join('') + '</span>';
  }
  // items: [{id, title, body, photo, meta, unreleased}]
  function galleryHtml(items, opts) {
    opts = opts || {};
    return '<div class="dg-gv' + (opts.compact ? ' compact' : '') + '">' + items.map(function (it) {
      const src = String(it.photo || '');
      let art;
      if (!src) art = '<span class="dg-gv-txt">' + esc(plain(it.body).slice(0, 320)) + '</span>';
      else if (isPdf(src)) art = '<span class="dg-gv-doc"><b>PDF</b></span>';
      else if (/^(https?:|data:image)/.test(src)) art = '<img class="dg-gv-ph" src="' + esc(src) + '" alt="" loading="lazy">';
      else art = '<span class="dg-gv-doc"><b>Photo</b></span>';
      return '<button type="button" class="dg-gv-t' + (it.unreleased ? ' unreleased' : '') + '" data-gv-id="' + esc(it.id) + '" style="--r:' + tilt(it.id).toFixed(2) + 'deg">' +
        art + (it.unreleased ? '<span class="dg-gv-unrel">Unreleased</span>' : '') +
        '<span class="dg-gv-cap">' + esc(it.title || 'Untitled') + '</span>' +
        (it.meta && !opts.compact ? '<span class="dg-gv-meta">' + esc(it.meta) + '</span>' : '') + '</button>';
    }).join('') + '</div>';
  }
  (function galleryStyles() {
    if (document.getElementById('dg-gv-style')) return;
    const st = document.createElement('style');
    st.id = 'dg-gv-style';
    st.textContent =
      '.dg-gv-switch{display:inline-flex;vertical-align:middle;border:1px solid rgba(28,22,8,.5);border-radius:2px;overflow:hidden}' +
      '.dg-gv-switch button{font:9.5px "Courier Prime",monospace;letter-spacing:.1em;text-transform:uppercase;padding:3px 8px;border:0;background:transparent;color:rgba(28,22,8,.7);cursor:pointer;line-height:1.4}' +
      '.dg-gv-switch button.on{background:rgba(28,22,8,.82);color:#f3ecd8}' +
      '.dg-gv{display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--gv-min,150px),1fr));gap:26px 20px;padding:12px 4px 6px}' +
      '.dg-gv.compact{--gv-min:86px;gap:14px 10px;padding-top:9px}' +
      '.dg-gv-t{position:relative;display:block;width:100%;text-align:center;font:inherit;color:#1c1608;cursor:pointer;border:0;' +
        'background:#fbf8ef;padding:9px 9px 13px;box-shadow:0 6px 14px rgba(0,0,0,.26);transform:rotate(var(--r,0deg));transition:transform .15s}' +
      '.dg-gv-t:hover,.dg-gv-t:focus-visible{transform:rotate(0deg) translateY(-3px);outline:none}' +
      '.dg-gv-t:focus-visible{box-shadow:0 0 0 2px #8b1f17,0 6px 14px rgba(0,0,0,.26)}' +
      '.dg-gv-t::before{content:"";position:absolute;top:-9px;left:50%;width:58px;height:18px;margin-left:-29px;background:rgba(235,226,196,.78);' +
        'transform:rotate(calc(var(--r,0deg) * -3));box-shadow:0 1px 2px rgba(0,0,0,.15);z-index:2}' +
      '.dg-gv-ph,.dg-gv-doc,.dg-gv-txt{display:block;width:100%;aspect-ratio:4/3;box-sizing:border-box}' +
      '.dg-gv-ph{object-fit:cover;background:#2a2418}' +
      '.dg-gv-doc{display:flex;align-items:center;justify-content:center;background:#efe8d3;border:1px solid rgba(28,22,8,.16)}' +
      '.dg-gv-doc b{font:400 14px "Special Elite",monospace;letter-spacing:.2em;text-transform:uppercase;color:#8b1f17;border:2px solid #8b1f17;padding:2px 10px;transform:rotate(-6deg)}' +
      '.dg-gv-txt{position:relative;overflow:hidden;padding:9px 11px;text-align:left;font:10.5px/1.55 "Courier Prime",monospace;color:rgba(28,22,8,.78);' +
        'background:#f6f1e3 repeating-linear-gradient(transparent 0 15.5px,rgba(70,110,170,.18) 15.5px 16.5px);border:1px solid rgba(28,22,8,.14)}' +
      '.dg-gv-txt::after{content:"";position:absolute;left:0;right:0;bottom:0;height:30px;background:linear-gradient(transparent,#f6f1e3)}' +
      '.dg-gv-cap{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:8px;font:12.5px/1.25 "Special Elite",monospace}' +
      '.dg-gv-meta{display:block;margin-top:3px;font:9.5px "Courier Prime",monospace;letter-spacing:.06em;text-transform:uppercase;color:rgba(28,22,8,.55)}' +
      '.dg-gv-unrel{position:absolute;top:14px;left:14px;font:9px "Special Elite",monospace;letter-spacing:.14em;text-transform:uppercase;color:#8b1f17;background:rgba(246,241,227,.92);border:1.5px solid #8b1f17;padding:2px 6px}' +
      '.dg-gv-t.unreleased .dg-gv-ph,.dg-gv-t.unreleased .dg-gv-doc,.dg-gv-t.unreleased .dg-gv-txt{opacity:.55}' +
      '.dg-gv.compact .dg-gv-t{padding:6px 6px 9px}.dg-gv.compact .dg-gv-t::before{width:36px;height:12px;top:-6px;margin-left:-18px}' +
      '.dg-gv.compact .dg-gv-cap{font-size:11px;margin-top:5px}.dg-gv.compact .dg-gv-txt{font-size:8.5px;padding:5px 6px}' +
      '.dg-gv.compact .dg-gv-doc b{font-size:10px;padding:1px 6px}' +
      '@media (max-width:560px){.dg-gv{--gv-min:132px;gap:20px 14px}.dg-gv-cap{font-size:12px}}';
    (document.head || document.documentElement).appendChild(st);
  })();
  window.dgEvidenceGallery = { html: galleryHtml, switchHtml: switchHtml, getView: getView, setView: setView, plain: plain };
})();
