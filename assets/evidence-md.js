/* Evidence text formatting -- a small, safe Markdown subset (v3.6.0).

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
})();
