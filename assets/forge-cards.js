/* Forged cover cards (v3.9.0): what the Field ID Fabricator makes on top
   of the agency credentials in assets/field-id-cards.js, and what A-Cell's
   ID Creator files as Evidence.

   Three kinds of card, all carrying a photo:
     mirror  the cover employer's credential (field-id-cards.js draws it)
     office  a "real-looking office": a card or badge from the Handler's
             evidence packs. The pictures are paid products, so they are
             NOT in this repo: the Handler uploads them once (A-Cell -> ID
             Creator) to Storage id-templates/, readable only when signed
             in. This file only knows where the words and photo go.
     entity  a company that never existed: a drawn logo + one of six
             drawn layouts.

     dgForge.REFS                     the evidence-pack designs
     dgForge.LAYOUTS                  the six drawn layouts
     dgForge.KINDS                    kinds of invented company
     dgForge.logo(spec)               an SVG logo ({shape, pal, name, kind} or {img})
     dgForge.logoChoices(name, kind, batch, palShift) -> 6 specs
     dgForge.render(card, opts)       HTML at the card's own size
         opts: {photo, refUrl(file), print, agency: {template, fields}}
     dgForge.size(card)               {w, h} of that card
     dgForge.fit(html, size, width)   the same HTML scaled to a width
     dgForge.roll.*                   believable random words */
(function () {
  if (window.dgForge) return;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
  function hash(s) { var h = 2166136261; s = String(s); for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { var x = (seed >>> 0) || 1; return function () { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return ((x >>> 0) % 100000) / 100000; }; }
  var SERIF = "'Liberation Serif','Times New Roman',Georgia,serif", SANS = "'Liberation Sans',Arial,Helvetica,sans-serif";

  /* ── Kinds of invented company: the motif in its logo, its job titles ── */
  var KINDS = [
    { key: 'energy', label: 'Utility / energy', motif: 'flame', titles: ['Field Technician', 'Meter Inspector', 'Safety Officer', 'Line Supervisor', 'Customer Service'], tags: ['Gas & heating since 1911', 'Keeping the county warm', 'Service you can count on'] },
    { key: 'trade', label: 'Shop / trade', motif: 'wrench', titles: ['Proprietor', 'Service Manager', 'Estimator', 'Technician', 'Sales Associate'], tags: ['Family owned since 1962', 'Quality work, fair prices', 'Licensed · Bonded · Insured'] },
    { key: 'finance', label: 'Insurance / finance', motif: 'columns', titles: ['Claims Adjuster', 'Loss Investigator', 'Account Manager', 'Underwriter', 'Senior Associate'], tags: ['Protecting what matters', 'Est. 1924', 'Trusted for three generations'] },
    { key: 'church', label: 'Church / charity', motif: 'cross', titles: ['Outreach Coordinator', 'Pastor', 'Counselor', 'Volunteer Lead', 'Brother'], tags: ['All are welcome', 'Serving the community', 'Faith in action'] },
    { key: 'clinic', label: 'Clinic / lab', motif: 'plus', titles: ['Lab Technician', 'Physician Assistant', 'Records Clerk', 'Field Epidemiologist', 'Medical Courier'], tags: ['Care close to home', 'Accredited laboratory', 'Science you can trust'] },
    { key: 'media', label: 'Media / press', motif: 'quill', titles: ['Staff Reporter', 'Producer', 'Photographer', 'Researcher', 'Stringer'], tags: ['Independent news', 'The story behind the story', 'Since 1938'] },
    { key: 'transport', label: 'Transport', motif: 'wheel', titles: ['Dispatcher', 'Driver', 'Safety Inspector', 'Logistics Coordinator', 'Yard Manager'], tags: ['On time, every time', 'Coast to coast', '24 hour dispatch'] },
    { key: 'security', label: 'Security', motif: 'key', titles: ['Security Consultant', 'Site Supervisor', 'Investigator', 'Risk Analyst', 'Patrol Officer'], tags: ['Discreet. Professional.', 'Licensed private security', 'Peace of mind, around the clock'] },
    // v3.10.0. tld: the e-mail domain the kind would really use.
    { key: 'university', label: 'University / college', motif: 'cap', tld: 'edu', titles: ['Professor', 'Visiting Researcher', 'Graduate Assistant', 'Dean of Students', 'Registrar', 'Campus Police'], tags: ['Lux et veritas', 'Founded 1857', 'Department of Anthropology'] },
    { key: 'library', label: 'Library / archive', motif: 'book', tld: 'org', titles: ['Reference Librarian', 'Archivist', 'Special Collections', 'Library Director', 'Records Clerk'], tags: ['Open to all', 'Special Collections & Archives', 'A Carnegie library, 1904'] },
    { key: 'municipal', label: 'City / town hall', motif: 'dome', tld: 'gov', titles: ['Code Inspector', 'Deputy Clerk', 'Building Official', 'Public Works Supervisor', 'Health Inspector'], tags: ['Incorporated 1871', 'Office of the City Clerk', 'Department of Public Works'] },
    { key: 'county', label: 'County government', motif: 'courthouse', tld: 'gov', titles: ['Deputy Assessor', 'County Clerk', 'Health Inspector', 'Coroner’s Investigator', 'Records Officer'], tags: ['The county seat', 'Office of the County Assessor', 'Recorder of Deeds'] },
    { key: 'legal', label: 'Law office', motif: 'scales', titles: ['Attorney at Law', 'Associate', 'Paralegal', 'Investigator', 'Process Server'], tags: ['Attorneys & counselors at law', 'Est. 1948', 'Estates · Injury · Criminal defense'] },
    { key: 'counsel', label: 'Counseling / social work', motif: 'heart', tld: 'org', titles: ['Licensed Counselor', 'Case Worker', 'Family Therapist', 'Grief Counselor', 'Intake Coordinator'], tags: ['You are not alone', 'Confidential counseling', 'Family & grief services'] }
  ];
  function kind(k) { return KINDS.filter(function (x) { return x.key === k; })[0] || KINDS[0]; }

  /* ── Logos: shapes × palettes, the kind's motif in the middle ── */
  var PALS = [['#1d3a5f', '#e07b1a', '#ffffff'], ['#0e4a3a', '#f08a1c', '#ffffff'], ['#2a2a2a', '#c22222', '#ffffff'], ['#3a1f5e', '#e0a030', '#ffffff'],
    ['#7a1010', '#1c1c1c', '#ffffff'], ['#0e5a5a', '#e0a030', '#ffffff'], ['#5a4a2a', '#e05a1a', '#f6f4ec'], ['#16246e', '#c9a227', '#ffffff'], ['#1f1f1f', '#8a8a8a', '#ffffff'], ['#0f3d22', '#4a1414', '#ffffff']];
  var SHAPES = ['ring', 'tile', 'plate', 'shield', 'mono', 'gear', 'hex', 'star'];
  function motif(m, col, bg) {
    switch (m) {
      case 'flame': return '<path d="M50,14 C62,32 74,40 70,60 C68,74 58,82 50,82 C40,82 30,74 30,60 C30,48 40,44 42,32 C46,40 52,42 50,14Z" fill="' + col + '"/><path d="M50,46 C56,54 60,58 58,66 C56,72 52,74 50,74 C46,74 42,70 42,64 C42,58 48,56 50,46Z" fill="' + bg + '"/>';
      case 'wrench': return '<path d="M64,18 a16,16 0 1 0 14,24 l-8,-2 -4,-8 4,-6 6,-2 a16,16 0 0 0 -12,-6Z" fill="' + col + '"/><rect x="26" y="40" width="12" height="44" rx="5" fill="' + col + '" transform="rotate(45 50 50)"/>';
      case 'columns': return '<path d="M20,34 L50,18 L80,34Z" fill="' + col + '"/><rect x="24" y="38" width="8" height="34" fill="' + col + '"/><rect x="40" y="38" width="8" height="34" fill="' + col + '"/><rect x="56" y="38" width="8" height="34" fill="' + col + '"/><rect x="70" y="38" width="6" height="34" fill="' + col + '"/><rect x="18" y="74" width="64" height="8" fill="' + col + '"/>';
      case 'cross': return '<rect x="44" y="14" width="12" height="72" fill="' + col + '"/><rect x="26" y="32" width="48" height="12" fill="' + col + '"/>';
      case 'plus': return '<rect x="40" y="18" width="20" height="64" rx="3" fill="' + col + '"/><rect x="18" y="40" width="64" height="20" rx="3" fill="' + col + '"/>';
      case 'quill': return '<path d="M74,14 C48,22 32,46 28,82 L34,82 C38,62 46,48 58,40 C52,48 48,56 46,64 C60,56 72,40 74,14Z" fill="' + col + '"/>';
      case 'wheel': return '<circle cx="50" cy="50" r="30" fill="none" stroke="' + col + '" stroke-width="8"/><circle cx="50" cy="50" r="8" fill="' + col + '"/>' + [0, 60, 120].map(function (a) { return '<rect x="47" y="22" width="6" height="56" fill="' + col + '" transform="rotate(' + a + ' 50 50)"/>'; }).join('');
      case 'key': return '<circle cx="50" cy="38" r="16" fill="' + col + '"/><circle cx="50" cy="38" r="6" fill="' + bg + '"/><rect x="45" y="50" width="10" height="34" fill="' + col + '"/><rect x="55" y="68" width="10" height="6" fill="' + col + '"/><rect x="55" y="78" width="7" height="6" fill="' + col + '"/>';
      case 'cap': return '<path d="M50,22 L88,38 L50,54 L12,38Z" fill="' + col + '"/><path d="M28,46 V62 C28,72 72,72 72,62 V46 L50,56Z" fill="' + col + '"/><rect x="83" y="38" width="3" height="24" fill="' + col + '"/><circle cx="84.5" cy="64" r="4" fill="' + col + '"/>';
      case 'book': return '<path d="M50,30 C40,24 24,24 12,28 V74 C24,70 40,70 50,76Z" fill="' + col + '"/><path d="M50,30 C60,24 76,24 88,28 V74 C76,70 60,70 50,76Z" fill="' + col + '"/><rect x="49" y="30" width="2" height="46" fill="' + bg + '"/>' +
        [38, 46, 54].map(function (y) { return '<path d="M20,' + y + ' C30,' + (y - 3) + ' 38,' + (y - 3) + ' 44,' + (y + 1) + ' M56,' + (y + 1) + ' C62,' + (y - 3) + ' 70,' + (y - 3) + ' 80,' + y + '" stroke="' + bg + '" stroke-width="1.6" fill="none"/>'; }).join('');
      case 'dome': return '<rect x="47" y="12" width="6" height="12" fill="' + col + '"/><path d="M30,42 A20,20 0 0 1 70,42Z" fill="' + col + '"/><rect x="22" y="42" width="56" height="6" fill="' + col + '"/>' +
        [26, 38, 52, 64].map(function (x) { return '<rect x="' + x + '" y="50" width="8" height="22" fill="' + col + '"/>'; }).join('') + '<rect x="16" y="74" width="68" height="9" fill="' + col + '"/>';
      case 'courthouse': return '<path d="M36,22 L50,8 L64,22Z" fill="' + col + '"/><rect x="38" y="22" width="24" height="26" fill="' + col + '"/><circle cx="50" cy="34" r="7" fill="' + bg + '"/><path d="M50,29 V34 H54" stroke="' + col + '" stroke-width="1.6" fill="none"/>' +
        '<rect x="18" y="48" width="64" height="36" fill="' + col + '"/>' + [24, 34, 60, 70].map(function (x) { return '<rect x="' + x + '" y="56" width="6" height="12" fill="' + bg + '"/>'; }).join('') + '<rect x="44" y="64" width="12" height="20" fill="' + bg + '"/>';
      case 'scales': return '<circle cx="50" cy="18" r="5" fill="' + col + '"/><rect x="48" y="20" width="4" height="58" fill="' + col + '"/><rect x="16" y="27" width="68" height="4" fill="' + col + '"/>' +
        '<path d="M22,31 L12,54 M22,31 L32,54 M78,31 L68,54 M78,31 L88,54" stroke="' + col + '" stroke-width="2.4" fill="none"/><path d="M9,54 Q22,68 35,54Z M65,54 Q78,68 91,54Z" fill="' + col + '"/><rect x="34" y="78" width="32" height="7" fill="' + col + '"/>';
      case 'heart': return '<path d="M50,84 C20,64 12,46 20,32 C28,20 44,21 50,34 C56,21 72,20 80,32 C88,46 80,64 50,84Z" fill="' + col + '"/><path d="M36,50 H44 L48,42 L53,60 L57,50 H64" stroke="' + bg + '" stroke-width="3" fill="none" stroke-linejoin="round"/>';
      default: return '';
    }
  }
  function initials(n) {
    return String(n || '').replace(/[^A-Za-z\s&]/g, ' ').split(/\s+/).filter(function (w) { return w && !/^(of|the|and|&|s|inc|llc|co)$/i.test(w); })
      .map(function (w) { return w.charAt(0).toUpperCase(); }).slice(0, 3).join('') || 'X';
  }
  function logo(spec) {
    spec = spec || {};
    if (spec.img) return '<img src="' + esc(spec.img) + '" alt="" style="width:100%;height:100%;object-fit:contain;display:block">';
    var p = spec.pal || PALS[0], a = p[0], b = p[1], c = p[2], name = String(spec.name || ''), ini = initials(name);
    var m = kind(spec.kind).motif, id = 'lg' + hash(name + (spec.shape || '') + p.join('')) % 1e7;
    var mid = function (s) { return '<g transform="translate(' + (50 - 50 * s) + ',' + (50 - 50 * s) + ') scale(' + s + ')">' + motif(m, b, c) + '</g>'; };
    var T = function (t, fs, col, y, it) { return '<text x="50" y="' + y + '" text-anchor="middle" font-family="' + SERIF + '"' + (it ? ' font-style="italic"' : '') + ' font-weight="700" font-size="' + fs + '" fill="' + col + '">' + esc(t) + '</text>'; };
    var body;
    switch (spec.shape) {
      case 'tile': body = '<rect x="8" y="8" width="84" height="84" rx="16" fill="' + a + '"/>' + mid(0.78); break;
      case 'plate': body = '<rect x="6" y="6" width="88" height="88" fill="' + c + '" stroke="' + a + '" stroke-width="5"/>' + mid(0.55).replace(/translate\(([\d.]+),([\d.]+)\)/, 'translate($1,10)') + T(ini, ini.length > 2 ? 15 : 19, a, 80) + '<rect x="14" y="85" width="72" height="4" fill="' + b + '"/>'; break;
      case 'shield': body = '<path d="M50,6 L88,18 L84,58 Q78,82 50,95 Q22,82 16,58 L12,18Z" fill="' + a + '" stroke="' + b + '" stroke-width="4"/>' + mid(0.56); break;
      case 'mono': body = '<circle cx="50" cy="50" r="45" fill="' + c + '" stroke="' + a + '" stroke-width="5"/>' + T(ini, ini.length > 2 ? 28 : 38, a, 63, true) + '<path d="M24,74 H76" stroke="' + b + '" stroke-width="3"/>'; break;
      case 'gear': body = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) { return '<rect x="45" y="2" width="10" height="16" fill="' + a + '" transform="rotate(' + i * 36 + ' 50 50)"/>'; }).join('') +
        '<circle cx="50" cy="50" r="36" fill="' + a + '"/><circle cx="50" cy="50" r="24" fill="' + c + '"/>' + mid(0.4); break;
      case 'hex': body = '<path d="M50,4 L90,27 V73 L50,96 L10,73 V27Z" fill="' + c + '" stroke="' + a + '" stroke-width="6"/><path d="M50,15 L80,32 V68 L50,85 L20,68 V32Z" fill="' + a + '"/>' + mid(0.5); break;
      case 'star': var d = ''; for (var i = 0; i < 10; i++) { var r = i % 2 ? 20 : 46, t = Math.PI * i / 5 - Math.PI / 2; d += (i ? 'L' : 'M') + (50 + r * Math.cos(t)).toFixed(1) + ',' + (50 + r * Math.sin(t)).toFixed(1); }
        body = '<circle cx="50" cy="50" r="48" fill="' + a + '"/><path d="' + d + 'Z" fill="' + c + '"/>' + T(ini, ini.length > 2 ? 9 : 12, a, 55); break;
      default: // ring: the name around a disc
        body = '<circle cx="50" cy="50" r="46" fill="' + a + '"/><circle cx="50" cy="50" r="30" fill="' + c + '"/>' +
          '<path id="' + id + '" d="M50,50 m-38,0 a38,38 0 1,1 76,0 a38,38 0 1,1 -76,0" fill="none"/>' +
          '<text font-family="' + SANS + '" font-weight="700" font-size="' + (name.length > 22 ? 7 : 8.6) + '" letter-spacing="1.4" fill="' + c + '"><textPath href="#' + id + '" startOffset="3%">' + esc(name.toUpperCase().slice(0, 30)) + ' ★</textPath></text>' + mid(0.42);
    }
    return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="width:100%;height:100%;display:block">' + body + '</svg>';
  }
  // Six logos for a name; each batch (⟳) brings six others; palShift
  // (◐) recolours the same shapes.
  function logoChoices(name, kindKey, batch, palShift) {
    var r = rng(hash(name + '|' + kindKey + '|' + (batch || 0)));
    // The first batch leads with the shapes that carry the kind's motif.
    var withMotif = ['ring', 'tile', 'shield', 'gear', 'hex', 'plate'], plain = ['mono', 'star'];
    var shapes = (batch ? SHAPES.slice().sort(function () { return r() - 0.5; }) : withMotif.concat(plain)).slice(0, 6);
    return shapes.map(function (sh, i) { return { shape: sh, pal: PALS[(Math.floor(r() * PALS.length) + (palShift || 0) + i) % PALS.length], name: name, kind: kindKey }; });
  }

  /* ── The photo on a card ── */
  function photoBox(photo, x, y, w, cardW) {
    // x, y in % of the card, w in px at the card's own size; 4:5.
    var h = Math.round(w * 1.28);
    return '<div class="dgf-photo" style="position:absolute;left:' + x + '%;top:' + y + '%;width:' + w + 'px;height:' + h + 'px;border:1px solid rgba(0,0,0,.55);box-shadow:0 1px 3px rgba(0,0,0,.35);background:#9a9a9a' +
      (photo ? ' url(&quot;' + esc(photo) + '&quot;) center 22%/cover' : '') + '">' + (photo ? '' : '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:6px ' + SANS + ';color:#eee;letter-spacing:.1em">PHOTO</span>') + '</div>';
  }
  function T(x, y, txt, font, color, extra) {
    if (!txt) return '';
    return '<div class="dgf-t" style="position:absolute;left:' + x + ';top:' + y + ';font:' + font + ';color:' + (color || '#111') + ';white-space:nowrap;' + (extra || '') + '">' + esc(txt) + '</div>';
  }
  function fitPx(text, max, room) { var n = String(text || '').length || 1; return Math.max(7, Math.min(max, Math.floor(room / (n * 0.56)))); }

  /* ── Six drawn layouts for an invented company (350×200) ── */
  var LAYOUTS = [
    { key: 'rule', label: 'Rule & logo' }, { key: 'band', label: 'Colour band' }, { key: 'letterhead', label: 'Letterhead' },
    { key: 'sealtitle', label: 'Seal & title' }, { key: 'stripes', label: 'Stripes' }, { key: 'plate', label: 'Diamond plate' }
  ];
  function drawn(e, photo) {
    var lg = e.logo || {}, p = lg.pal || PALS[0], ink = p[0], acc = p[1];
    var L = function (x, y, w, h) { return '<div style="position:absolute;left:' + x + 'px;top:' + y + 'px;width:' + w + 'px;height:' + h + 'px">' + logo(lg) + '</div>'; };
    var org = e.org || '', name = e.name || '', title = e.title || '', phone = e.phone || '', mail = e.mail || '', tag = e.tag || '';
    var bg = '#fff', inner = '';
    switch (e.layout) {
      case 'band':
        bg = ink;
        inner = T('0', '20px', tag, '15px ' + SANS, '#fff', 'width:100%;text-align:center;letter-spacing:.18em') +
          T('0', '66px', name, '700 ' + fitPx(name, 19, 300) + 'px ' + SANS, '#fff', 'width:100%;text-align:center') +
          '<div style="position:absolute;left:46px;right:46px;top:96px;height:2px;background:#fff"></div>' +
          T('0', '104px', org.toLowerCase(), fitPx(org, 13, 300) + 'px ' + SANS, '#fff', 'width:100%;text-align:center;letter-spacing:.12em') +
          T('22px', '158px', phone, '9px ' + SANS, '#fff') + T('22px', '172px', mail, '9px ' + SANS, '#fff') + L(304, 154, 36, 36) + photoBox(photo, 70, 64, 34);
        break;
      case 'letterhead':
        var fs = Math.min(22, Math.floor(330 / Math.max(org.length, 1)));
        inner = L(16, 20, 86, 86) +
          T('110px', (24 + Math.max(0, 22 - fs)) + 'px', org, '600 ' + fs + 'px ' + SERIF, acc, 'letter-spacing:.12em;font-variant:small-caps') +
          '<div style="position:absolute;left:110px;right:12px;top:56px;height:5px;background:' + ink + '"></div>' +
          T('auto', '64px', tag, '7px ' + SANS, acc, 'right:14px;letter-spacing:.06em;text-transform:uppercase') +
          T('auto', '92px', mail, '8px ' + SANS, acc, 'right:14px;text-align:right') + T('auto', '103px', phone, '8px ' + SANS, acc, 'right:14px;text-align:right') +
          T('8px', '122px', name, 'italic 700 ' + fitPx(name, 24, 270) + 'px ' + SERIF, acc, 'width:280px;text-align:center') +
          T('8px', '154px', title, '11px ' + SERIF, acc, 'width:280px;text-align:center') + photoBox(photo, 85, 61, 34);
        break;
      case 'sealtitle':
        inner = L(16, 22, 86, 86) +
          T('122px', '24px', org, fitPx(org, 20, 210) + 'px ' + SERIF, '#111', 'letter-spacing:.03em') +
          '<div style="position:absolute;left:122px;right:12px;top:52px;height:1.5px;background:#111"></div>' +
          T('122px', '60px', tag, '10px ' + SERIF, '#333', 'letter-spacing:.1em') +
          T('122px', '92px', name, '700 ' + fitPx(name, 15, 210) + 'px ' + SERIF) + T('122px', '112px', title, 'bold 11px ' + SERIF) +
          T('122px', '144px', phone ? 'Telephone: ' + phone : '', '10px ' + SERIF) + T('122px', '158px', mail ? 'E-mail: ' + mail : '', fitPx('E-mail: ' + mail, 10, 215) + 'px ' + SERIF) + photoBox(photo, 8, 61, 40);
        break;
      case 'stripes':
        inner = '<div style="position:absolute;left:0;right:0;top:0;height:34px;background:' + acc + '"></div><div style="position:absolute;left:0;right:0;bottom:0;height:34px;background:' + acc + '"></div>' +
          L(18, 46, 108, 108) + T('146px', '52px', name, '700 ' + fitPx(name, 16, 150) + 'px ' + SANS) + T('146px', '74px', title, '10px ' + SANS) +
          T('146px', '102px', org, fitPx(org, 9.5, 160) + 'px ' + SANS, '#333') + T('146px', '116px', phone, '9px ' + SANS, '#333') + T('146px', '129px', mail, '9px ' + SANS, '#333') + photoBox(photo, 81, 23, 46);
        break;
      case 'plate':
        bg = '#08105a;background-image:repeating-linear-gradient(60deg,rgba(120,150,255,.35) 0 2px,transparent 2px 22px),repeating-linear-gradient(-60deg,rgba(0,0,0,.35) 0 2px,transparent 2px 22px)';
        inner = T('16px', '14px', org, '700 ' + fitPx(org, 20, 250) + 'px ' + SANS, '#fff', 'text-shadow:0 2px 3px #000') + T('16px', '42px', tag, '11px ' + SANS, '#cfd6ff') +
          T('16px', '150px', name, '700 14px ' + SANS, '#fff') + T('16px', '170px', phone, '9px ' + SANS, '#cfd6ff') + T('16px', '182px', mail, '9px ' + SANS, '#cfd6ff') +
          '<div style="position:absolute;right:18px;top:78px;width:96px;height:66px;border:3px solid #111;border-radius:9px;transform:rotate(9deg);background:#fff;display:flex;align-items:center;justify-content:center"><div style="width:54px;height:54px">' + logo(lg) + '</div></div>' +
          photoBox(photo, 81, 5, 36);
        break;
      default: // rule & logo
        inner = T('18px', '26px', name, '700 ' + fitPx(name, 17, 230) + 'px ' + SERIF) + T('18px', '48px', title, '10px ' + SANS, '#444') +
          '<div style="position:absolute;left:12px;right:96px;top:66px;height:1.5px;background:#111"></div>' +
          L(20, 126, 58, 58) + T('86px', '132px', org.toUpperCase(), '700 ' + Math.min(13, Math.floor(300 / Math.max(org.length, 1))) + 'px ' + SERIF, '#111', 'letter-spacing:.08em') +
          T('86px', '150px', tag, 'italic 9px ' + SERIF, '#555') +
          T('auto', '166px', phone, '9px ' + SANS, '#111', 'right:16px') + T('auto', '178px', mail, '9px ' + SANS, '#111', 'right:16px') + photoBox(photo, 77, 6, 52);
    }
    return '<div class="dgf-card" style="position:relative;width:350px;height:200px;overflow:hidden;border-radius:4px;background:' + bg + '">' + inner + '</div>';
  }

  /* ── The evidence-pack designs (pictures in Storage id-templates/) ──
     Cards are 1050×613 crops shown at 350×204; badges 520×753 at 230×333.
     Each field: k, label, roll (a dice roller name) or opts (chips). */
  var SHERIFF_RANKS = ['Deputy', 'Sergeant', 'Investigator', 'Chief Deputy', 'Sheriff'];
  var REFS = [
    { key: 'sheriff', label: 'Sheriff', file: 'sheriff.jpg', type: 'card',
      fields: [{ k: 'place', label: 'County', roll: 'county' }, { k: 'rank', label: 'Rank', opts: SHERIFF_RANKS }, { k: 'name', label: 'Name on the card' }, { k: 'phone', label: 'Phone', roll: 'phone' }, { k: 'badge', label: 'Badge no.', roll: 'badge' }],
      draw: function (f, ph) { return sheriffDraw(f, ph); } },
    { key: 'sheriff-az', label: 'Sheriff · Arizona', file: 'sheriff-az.jpg', type: 'card',
      fields: [{ k: 'place', label: 'County', roll: 'azcounty' }, { k: 'rank', label: 'Rank', opts: SHERIFF_RANKS }, { k: 'name', label: 'Name on the card' }, { k: 'phone', label: 'Phone', roll: 'phone' }, { k: 'badge', label: 'Badge no.', roll: 'badge' }],
      draw: function (f, ph) { return sheriffDraw(f, ph); } },
    { key: 'oakgrove', label: 'City of Oak Grove', file: 'oakgrove.jpg', type: 'card',
      fields: [{ k: 'dept', label: 'Department', opts: ['Code Enforcement', 'Public Works', 'Building Inspection', 'City Clerk', 'Water Department'] }, { k: 'name', label: 'Name on the card' }, { k: 'title', label: 'Title', opts: ['Inspector', 'Clerk', 'Supervisor', 'Field Officer'] }, { k: 'phone', label: 'Phone', roll: 'phone' }],
      draw: function (f, ph) { return T('0', '61%', f.name, '700 13px ' + SERIF, '#111', 'width:100%;text-align:center') + T('0', '71%', [f.title, f.dept].filter(Boolean).join(' · '), '10px ' + SERIF, '#333', 'width:100%;text-align:center') + T('0', '80%', f.phone, '9.5px ' + SERIF, '#333', 'width:100%;text-align:center') + photoBox(ph, 7, 28, 44); } },
    { key: 'fire', label: 'Fire / EMS', file: 'fire.jpg', type: 'card',
      fields: [{ k: 'place', label: 'Department', roll: 'firedept' }, { k: 'rank', label: 'Rank', opts: ['Firefighter', 'Paramedic', 'Fire Investigator', 'Lieutenant', 'Captain'] }, { k: 'name', label: 'Name on the card' }, { k: 'phone', label: 'Phone', roll: 'phone' }],
      draw: function (f, ph) { return T('42%', '28%', f.name, '700 ' + fitPx(f.name, 15, 140) + 'px ' + SANS) + T('42%', '39%', f.rank, '10px ' + SANS) + T('42%', '50%', f.place, fitPx(f.place, 9.5, 130) + 'px ' + SANS, '#333') + T('42%', '60%', f.phone, '9px ' + SANS, '#333') + photoBox(ph, 84, 24, 42); } },
    { key: 'nps', label: 'Park Service', file: 'nps.jpg', type: 'card',
      fields: [{ k: 'place', label: 'Park', roll: 'park' }, { k: 'title', label: 'Title', opts: ['Park Ranger', 'Law Enforcement Ranger', 'Wildlife Biologist', 'Interpretive Ranger', 'Chief Ranger'] }, { k: 'name', label: 'Name on the card' }, { k: 'phone', label: 'Phone', roll: 'phone' }],
      draw: function (f, ph) { return T('37%', '28%', f.name, '700 ' + fitPx(f.name, 15, 140) + 'px ' + SANS) + T('37%', '39%', f.title, '10px ' + SANS, '#333') + T('37%', '49%', f.place, fitPx(f.place, 9.5, 130) + 'px ' + SANS, '#333') + T('37%', '63%', f.phone, '9px ' + SANS, '#333') + photoBox(ph, 82, 24, 44); } },
    { key: 'fbi', label: 'FBI (business card)', file: 'fbi.jpg', type: 'card',
      fields: [{ k: 'name', label: 'Name on the card' }, { k: 'phone', label: 'Telephone', roll: 'phone' }, { k: 'fax', label: 'Fax', roll: 'phone' }, { k: 'mail', label: 'E-mail', roll: 'fbimail' }],
      draw: function (f, ph) { return T('39%', '41%', f.name, '700 ' + fitPx(f.name, 14, 150) + 'px ' + SERIF) + T('62%', '77%', f.phone, '9.5px ' + SERIF) + T('62%', '82.5%', f.fax, '9.5px ' + SERIF) + T('62%', '88%', f.mail, '9px ' + SERIF) + photoBox(ph, 9, 55, 38); } },
    { key: 'tow', label: 'Towing', file: 'tow.jpg', type: 'card',
      fields: [{ k: 'org', label: 'Company', roll: 'towco' }, { k: 'name', label: 'Name on the card' }, { k: 'phone', label: 'Phone', roll: 'phone' }],
      draw: function (f, ph) { return T('4%', '6%', f.org, '700 ' + fitPx(f.org, 19, 200) + 'px ' + SANS, '#fff', 'text-shadow:0 2px 3px #000') + T('4%', '19%', '24 HOUR TOWING & RECOVERY', '9px ' + SANS, '#cfd6ff', 'letter-spacing:.08em') + T('4%', '72%', f.name, '700 13px ' + SANS, '#fff', 'text-shadow:0 1px 2px #000') + T('4%', '83%', f.phone, '700 12px ' + SANS, '#fff', 'text-shadow:0 1px 2px #000') + photoBox(ph, 4, 32, 36); } },
    { key: 'ewrail', label: 'Railway', file: 'ewrail.jpg', type: 'card',
      fields: [{ k: 'name', label: 'Name on the card' }, { k: 'title', label: 'Title', opts: ['Track Inspector', 'Signal Maintainer', 'Claims Agent', 'Conductor', 'Special Agent, Railroad Police'] }, { k: 'phone', label: 'Phone', roll: 'phone' }],
      draw: function (f, ph) { return T('4%', '4%', f.name, '700 ' + fitPx(f.name, 15, 220) + 'px ' + SERIF) + T('4%', '20%', f.title, '10px ' + SANS, '#333') + T('auto', '76%', f.phone, '9px ' + SANS, '#111', 'right:5%') + photoBox(ph, 80, 25, 42); } },
    { key: 'podcast', label: 'Podcast', file: 'podcast.jpg', type: 'card',
      fields: [{ k: 'name', label: 'Name on the card' }, { k: 'title', label: 'Role', opts: ['Host', 'Producer', 'Researcher', 'Field Reporter'] }, { k: 'phone', label: 'Phone', roll: 'phone' }, { k: 'mail', label: 'E-mail / handle', roll: 'handle' }],
      draw: function (f, ph) { return T('0', '22%', f.name, '700 ' + fitPx(f.name, 15, 240) + 'px ' + SANS, '#fff', 'width:100%;text-align:center;letter-spacing:.06em') + T('0', '31%', f.title, '9px ' + SANS, '#dfe3ff', 'width:100%;text-align:center;letter-spacing:.2em;text-transform:uppercase') + T('15%', '78%', f.phone, '9px ' + SANS, '#fff') + T('15%', '86%', f.mail, '9px ' + SANS, '#fff') + photoBox(ph, 84, 54, 34); } },
    { key: 'faith', label: 'Ministry', file: 'faith.jpg', type: 'card',
      fields: [{ k: 'name', label: 'Name on the card', roll: 'brother' }, { k: 'title', label: 'Title', opts: ['Counselor', 'Intercessor', 'Outreach Minister', 'Deacon'] }],
      draw: function (f, ph) { return T('17%', '53%', f.name, '700 ' + fitPx(f.name, 26, 250) + 'px ' + SERIF, '#4a1414', 'width:73%;text-align:center') + T('17%', '70%', f.title, '11px ' + SERIF, '#4a1414', 'width:73%;text-align:center') + photoBox(ph, 5, 52, 32); } },
    { key: 'titan', label: 'Forensics LLC', file: 'titan.jpg', type: 'card',
      fields: [{ k: 'name', label: 'Name on the card' }, { k: 'title', label: 'Title', opts: ['Forensic Consultant', 'Bloodstain Pattern Analyst', 'Crime Scene Technician', 'Senior Investigator'] }, { k: 'phone', label: 'Phone', roll: 'phone' }],
      draw: function (f, ph) { return T('5%', '60%', f.name, '700 ' + fitPx(f.name, 14, 150) + 'px ' + SANS) + T('5%', '70%', f.title, '9.5px ' + SANS, '#555') + T('5%', '79%', f.phone, '9px ' + SANS, '#555') + photoBox(ph, 44, 50, 34); } }
  ];
  function sheriffDraw(f, ph) {
    return T('37%', '19%', [f.rank && f.rank !== 'Sheriff' ? f.rank : '', f.name].filter(Boolean).join(' '), '700 ' + fitPx((f.rank || '') + ' ' + (f.name || ''), 16, 210) + 'px ' + SERIF) +
      T('37%', '32%', f.rank === 'Sheriff' ? 'Sheriff' : 'Patrol Division', '11px ' + SANS, '#333') +
      T('37%', '42%', f.place ? f.place + " Sheriff’s Office" : '', 'italic ' + fitPx(f.place + " Sheriff's Office", 11, 200) + 'px ' + SERIF, '#333') +
      T('2%', '81.5%', f.badge ? 'BADGE #' + f.badge : '', '8px ' + SANS, '#fff', 'width:29%;text-align:center') +
      T('auto', '84%', f.phone, '700 12px ' + SANS, '#fff', 'right:4%') + photoBox(ph, 12.5, 56, 37);
  }
  // The forensic lab badges: one per state, the department printed on it.
  ['oregon', 'arizona', 'nebraska', 'alabama', 'montana'].forEach(function (st) {
    REFS.push({ key: 'badge-' + st, label: 'Forensics lab badge · ' + (st === 'montana' ? 'Oregon (Montana seal)' : st.charAt(0).toUpperCase() + st.slice(1)), file: 'badge-' + st + '.png', type: 'badge',
      fields: [{ k: 'name', label: 'Name on the badge' }, { k: 'title', label: 'Title', opts: ['Forensic Scientist', 'Evidence Technician', 'Senior Forensic Investigator', 'Forensic Pathology Specialist', 'Computer Forensics Specialist'] }],
      draw: function (f, ph) {
        return '<div class="dgf-photo" style="position:absolute;left:22.5%;top:32.5%;width:55%;height:49%;background:#9a9a9a' + (ph ? ' url(&quot;' + esc(ph) + '&quot;) center 20%/cover' : '') + '"></div>' +
          T('0', '82.5%', f.name, '700 ' + fitPx(f.name, 18, 200) + 'px ' + SERIF, '#222', 'width:100%;text-align:center;line-height:1.1') + T('0', '90.5%', f.title, fitPx(f.title, 11, 200) + 'px ' + SERIF, '#111', 'width:100%;text-align:center;line-height:1.1');
      } });
  });
  function ref(key) { return REFS.filter(function (r) { return r.key === key; })[0] || null; }

  /* ── Rendering any card ── */
  function size(card) {
    if (!card) return { w: 350, h: 200 };
    if (card.proto === 'office') { var r = ref(card.tpl); return r && r.type === 'badge' ? { w: 230, h: 333 } : { w: 350, h: 204 }; }
    if (card.proto === 'mirror') {
      var C = window.dgFieldIdCards, tm = C && (C.template(card.agency || 'DG', card.era || '20s') || C.template('DG', '10s'));
      return tm && tm.is_credential_book ? { w: 220, h: 390 } : { w: 323, h: 204 };
    }
    return { w: 350, h: 200 };
  }
  var PROP = '<div style="position:absolute;left:0;right:0;bottom:1px;text-align:center;font:600 5.5px ' + SANS + ';letter-spacing:.14em;color:rgba(140,20,20,.85);z-index:60">PROP · NOT A REAL ID · TABLETOP GAME</div>';
  function render(card, opts) {
    opts = opts || {};
    var html = '', ph = opts.photo || '';
    if (!card) return '';
    if (card.proto === 'office') {
      var r = ref(card.tpl), sz = size(card), url = r && opts.refUrl ? opts.refUrl(r.file) : '';
      if (!r) return '';
      html = '<div class="dgf-card dgf-ref" data-tpl="' + r.key + '" style="position:relative;width:' + sz.w + 'px;height:' + sz.h + 'px;overflow:hidden;border-radius:' + (r.type === 'badge' ? 12 : 4) + 'px;background:#ddd' +
        (url ? ' url(&quot;' + esc(url) + '&quot;) center/100% 100% no-repeat' : '') + '">' +
        (url ? '' : '<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font:9px ' + SANS + ';color:#666;letter-spacing:.1em;text-align:center;padding:0 20px">STOCK NOT LOADED · ' + esc(r.label.toUpperCase()) + '</div>') +
        r.draw(card.fields || {}, ph) + (opts.print ? PROP : '') + '</div>';
    } else if (card.proto === 'entity') {
      html = drawn(card, ph);
      if (opts.print) html = html.replace(/<\/div>$/, PROP + '</div>');
    } else if (card.proto === 'mirror') {
      var C = window.dgFieldIdCards;
      if (!C) return '';
      var tm = opts.template || C.template(card.agency || 'DG', card.era || '20s') || C.template('DG', '10s');
      html = '<div class="dgf-card dgf-mirror" style="position:relative;width:' + size(card).w + 'px">' + C.render(tm, card.fields || {}, ph) + (opts.print ? PROP : '') + '</div>';
    }
    return html;
  }
  function fit(html, sz, width) {
    var k = width / sz.w;
    return '<div class="dgf-fit" style="position:relative;width:' + Math.round(sz.w * k) + 'px;height:' + Math.round(sz.h * k) + 'px;overflow:hidden">' +
      '<div style="width:' + sz.w + 'px;transform:scale(' + k + ');transform-origin:top left">' + html + '</div></div>';
  }

  /* ── Believable random words ── */
  var COUNTIES = ['Harlan County', 'Pike County', 'Coos County', 'Ellsworth County', 'Tillamook County', 'Lander County', 'Wythe County', 'Bastrop County', 'Okanogan County', 'Clatsop County', 'Sevier County', 'Ozark County', 'Lamar County', 'Crook County', 'Mineral County', 'Tioga County'];
  var AZ = ['Coconino County', 'Yavapai County', 'Mohave County', 'Navajo County', 'Cochise County', 'Gila County', 'Apache County', 'La Paz County'];
  var TOWNS = ['Coos Bay', 'Ellsworth', 'Halvorsen', 'Pine Hollow', 'Marrow Creek', 'Dunning', 'Cornville', 'Putnam', 'Boring', 'Hardin', 'Wickett', 'Silt'];
  var PARKS = ['Yellowstone National Park', 'Great Basin National Park', 'Olympic National Park', 'Big Bend National Park', 'Mesa Verde National Park', 'Isle Royale National Park', 'Craters of the Moon N.M.'];
  var COS = { energy: ['Meadowbrook Gasworks', 'Tri-County Power & Light', 'Halvorsen Propane'], trade: ['Pike & Sons Hardware', 'Lindqvist Locksmiths', 'Marrow Creek Plumbing'], finance: ['Halvorsen & Pike Insurance', 'First Prairie Mutual', 'Ostrander Claims Bureau'], church: ['St. Brendan’s Mission', 'Grace Fellowship Outreach', 'Lantern House Ministries'], clinic: ['Pine Hollow Medical Lab', 'Westridge Diagnostics', 'Coastal Blood Services'], media: ['The Coos Bay Clarion', 'KRZN Radio 1040', 'Northwest Signal Weekly'], transport: ['Ostrander Freight Lines', 'Silver Valley Couriers', 'Three Rivers Transit'], security: ['Blackwater Ridge Security', 'Sentinel Alarm & Patrol', 'Keystone Investigations'],
    university: ['Halvorsen State University', 'Whitcombe College', 'Northern Plains A&M'], library: ['Ashford Public Library', 'Marrow Creek Carnegie Library', 'Whitcombe County Historical Archive'],
    municipal: ['City of Marrow Creek', 'Town of Pine Hollow', 'City of Silver Valley'], county: ['Ostrander County', 'Three Rivers County', 'Coos Bend County'],
    legal: ['Pike, Lindqvist & Marsh', 'Halvorsen Law Office', 'Ostrander & Byrne, Attorneys at Law'], counsel: ['Lantern House Counseling', 'Pine Hollow Family Services', 'Three Rivers Crisis Center'] };
  var roll = {
    county: function () { return pick(COUNTIES); },
    azcounty: function () { return pick(AZ); },
    town: function () { return pick(TOWNS); },
    park: function () { return pick(PARKS); },
    firedept: function () { return pick(TOWNS) + ' Fire & Rescue'; },
    towco: function () { return pick(['Big Rig', 'Pike', 'Night Owl', 'Ironside', 'Hook & Haul']) + ' Towing'; },
    phone: function () { return '(' + pick(['206', '503', '520', '531', '205', '606', '608', '715', '307', '505']) + ') 555-' + String(100 + Math.floor(Math.random() * 9800)).padStart(4, '0'); },
    badge: function () { return String(100 + Math.floor(Math.random() * 900)); },
    fbimail: function (name) { var n = String(name || 'agent').toLowerCase().replace(/[^a-z ]/g, '').trim().split(/\s+/); return (n[0] ? n[0].charAt(0) : 'a') + (n[n.length - 1] || 'agent') + '@fbi.gov'; },
    handle: function (name) { return '@' + String(name || 'listener').toLowerCase().replace(/[^a-z]/g, '').slice(0, 12) + 'pod'; },
    brother: function () { return 'Brother ' + pick(['Zachariel', 'Abiel', 'Jonas', 'Ezra', 'Silas', 'Tobias']); },
    company: function (k) { return pick(COS[k] || COS.energy); },
    mail: function (org, name, k) { var d = String(org || 'company').toLowerCase().replace(/[^a-z]/g, '').slice(0, 16) || 'company'; var n = String(name || '').toLowerCase().split(/\s+/).filter(Boolean); return (n.length ? n[0].charAt(0) + n[n.length - 1] : 'info') + '@' + d + '.' + ((k && kind(k).tld) || 'com'); }
  };

  /* ── Printing in place (no new tab: a phone had no way back from one) ──
     An overlay on the top page (the notebook's, when the Fabricator is in
     its frame) with the card at its real size, Print and Done; the print
     stylesheet hides everything else. The PROP line is on the paper only. */
  function topDoc() { try { if (window.top && window.top.document && window.top.document.body) return window.top.document; } catch (e) { /* not ours */ } return document; }
  function print(html, sz, inches) {
    var d = topDoc(), w = d.defaultView, old = d.getElementById('dgf-print');
    if (old) old.remove();
    var widthIn = inches || (sz.w > sz.h ? 3.5 : 2.6), px = widthIn * 96, k = px / sz.w;
    var box = d.createElement('div');
    box.id = 'dgf-print';
    box.innerHTML = '<style>#dgf-print{position:fixed;inset:0;z-index:2147483600;background:rgba(10,8,4,.86);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;font:13px "Courier Prime",monospace}' +
      '#dgf-print .sheet{background:#fff;padding:22px 26px;box-shadow:0 10px 30px rgba(0,0,0,.6);display:flex;flex-direction:column;align-items:center;gap:8px;max-width:calc(100vw - 24px);overflow:hidden}' +
      '#dgf-print .sheet small{font-size:9px;letter-spacing:.12em;color:#666}' +
      '#dgf-print .bar{display:flex;gap:10px}#dgf-print button{font:12px "Special Elite",monospace;letter-spacing:.12em;text-transform:uppercase;padding:10px 18px;border:1px solid #3fbf3f;background:#0b140b;color:#7fff7f;cursor:pointer}' +
      '#dgf-print button.go{background:#1f6f1f;color:#e8ffe8}' +
      '@media print{body > *:not(#dgf-print){display:none!important}#dgf-print{position:static;background:#fff;display:block}#dgf-print .bar,#dgf-print small{display:none}#dgf-print .sheet{box-shadow:none;padding:0}}</style>' +
      '<div class="sheet"><div style="width:' + Math.round(sz.w * k) + 'px;height:' + Math.round(sz.h * k) + 'px;overflow:hidden"><div style="width:' + sz.w + 'px;transform:scale(' + k + ');transform-origin:top left">' + html + '</div></div>' +
      '<small>ACTUAL SIZE · ' + widthIn + ' IN WIDE · PROP — NOT A REAL ID</small></div>' +
      '<div class="bar"><button type="button" class="go" data-p="print">⎙ Print</button><button type="button" data-p="done">✕ Done</button></div>';
    d.body.appendChild(box);
    function close() { box.remove(); d.removeEventListener('keydown', onKey, true); }
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); close(); } }
    d.addEventListener('keydown', onKey, true);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-p]');
      if (b && b.getAttribute('data-p') === 'print') { try { w.focus(); w.print(); } catch (err) { /* blocked */ } return; }
      if ((b && b.getAttribute('data-p') === 'done') || e.target === box) close();
    });
    return box;
  }

  window.dgForge = { REFS: REFS, LAYOUTS: LAYOUTS, KINDS: KINDS, PALS: PALS, kind: kind, ref: ref, logo: logo, logoChoices: logoChoices, render: render, size: size, fit: fit, roll: roll, esc: esc, print: print };
})();
