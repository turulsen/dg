/* Mental disorders, as listed in the Rules reference (rules-reference.html,
   "Mental Disorders"): one entry per disorder, with the kinds of trauma
   that can cause it, its trigger and its effect, summarised. The
   character sheet's Mental Disorders list picks from these (or "Other…"
   for anything the Handler improvises); A-Cell shows the same summary.

   Sheets used to keep Motivations and Mental Disorders in one free-text
   box (the printed DD Form 315 still has a single box 12 for both):
   splitText() pulls disorder lines out of such a text, and combine()
   writes both back into one for the PDF/Sheets/printable exports, each
   disorder on its own "Disorder: …" line so a re-import splits again.

   window.dgDisorders = { list, find, splitText, combine, describe } */
(function () {
  'use strict';
  var V = 'Violence', H = 'Helplessness', U = 'Unnatural';
  var TS = 'Temporary insanity or Breaking Point';
  var list = [
    { name: 'Addiction', kinds: [V, H], trigger: 'Losing 2+ SAN', effect: 'Overwhelming need. Indulging: −20% to stats and skills for a few hours. Every 24 hours without, lose 1D6 WP and cannot recover WP; at 2 WP or less, irrational and self-destructive.' },
    { name: 'Amnesia', kinds: [U], trigger: 'Losing 2+ SAN', effect: 'Erases all memory of the episode.' },
    { name: 'Anxiety Disorder', kinds: [H], trigger: 'Losing 2+ SAN', effect: '−20% to all skill, stat and SAN tests.' },
    { name: 'Conversion Disorder', kinds: [H], trigger: TS, effect: 'Blind, deaf or paralyzed until the stress subsides.' },
    { name: 'Depersonalization', kinds: [U], trigger: 'Losing 2+ SAN', effect: '−20% to skill and stat tests.' },
    { name: 'Depression', kinds: [V, H, U], trigger: 'Reminders of past traumas', effect: 'Every skill or stat test costs 1D4 WP.' },
    { name: 'Dissociative Identity Disorder', aliases: ['DID'], kinds: [H, U], trigger: TS, effect: 'Takes on an alternate identity or personality.' },
    { name: 'Enclosure-related Phobia', aliases: ['Claustrophobia', 'Agoraphobia'], kinds: [H], trigger: 'Entering a distinctly open or enclosed place', effect: 'SAN tests at −20%.' },
    { name: 'Fugues', aliases: ['Fugue'], kinds: [U], trigger: TS, effect: 'Becomes catatonic or wanders off.' },
    { name: 'Intermittent Explosive Disorder', aliases: ['IED'], kinds: [V], trigger: 'Losing 2+ SAN', effect: 'Filled with rage; strong temptation to attack.' },
    { name: 'Ligyrophobia', kinds: [V], trigger: 'Loud noises', effect: 'SAN tests at −20%.' },
    { name: 'Megalomania', kinds: [U], trigger: 'Losing 2+ SAN', effect: 'Stat or skill tests to help others or make a good impression fail.' },
    { name: 'Obsession', kinds: [H], trigger: 'Losing 2+ SAN', effect: 'For several days, long-term actions at −20%.' },
    { name: 'OCD', aliases: ['Obsessive-Compulsive Disorder', 'Obsessive Compulsive Disorder'], kinds: [H], trigger: 'Losing 2+ SAN', effect: '−20% to all skill, stat and SAN tests until things are put in order.' },
    { name: 'Paranoia', kinds: [V, U], trigger: 'Losing 2+ SAN', effect: 'Cannot trust or rely on anyone.' },
    { name: 'PTSD', aliases: ['Post-Traumatic Stress Disorder', 'Post Traumatic Stress Disorder'], kinds: [V], trigger: 'Reminders of past traumas', effect: 'Reacts violently, or each skill or stat test costs 1D4 WP.' },
    { name: 'Sleep Disorder', aliases: ['Insomnia'], kinds: [V, U], trigger: 'Trying to sleep', effect: 'SAN test; on a failure, cannot rest or regain WP for 24 hours.' },
    { name: 'Totemic Compulsion', kinds: [V], trigger: 'Losing or being without the totem', effect: '−10% to every skill, stat and SAN test until it is recovered.' }
  ];

  function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function namesOf(d) { return [d.name].concat(d.aliases || []); }

  // The list entry a name stands for (case and aliases ignored), or null.
  function find(name) {
    var n = norm(name);
    if (!n) return null;
    for (var i = 0; i < list.length; i++) {
      if (namesOf(list[i]).some(function (x) { return norm(x) === n; })) return list[i];
    }
    return null;
  }

  function startsWithKnown(line) {
    var n = norm(line);
    for (var i = 0; i < list.length; i++) {
      var hit = namesOf(list[i]).some(function (x) {
        var k = norm(x);
        return n === k || (n.indexOf(k) === 0 && /^[\s(,:;.\-–—]/.test(n.slice(k.length)));
      });
      if (hit) return list[i];
    }
    return null;
  }

  // Splits an old combined "Motivations and Mental Disorders" text: lines
  // marked "Disorder: …" / "Mental disorder: …", or starting with a known
  // disorder's name, become disorders; everything else stays a Motivation.
  function splitText(text) {
    var mot = [], dis = [];
    String(text || '').split(/\r?\n/).forEach(function (raw) {
      var line = raw.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim();
      if (!line) { if (raw.trim() === '' && mot.length) mot.push(''); return; }
      var m = line.match(/^(?:mental\s+)?disorders?\s*[:\-–—]\s*(.+)$/i);
      if (m) { var k = find(m[1]); dis.push(k ? k.name : m[1].trim()); return; }
      var known = startsWithKnown(line);
      if (known) { dis.push(norm(line) === norm(known.name) || find(line) ? known.name : line); return; }
      mot.push(raw.replace(/\s+$/, ''));
    });
    while (mot.length && mot[mot.length - 1] === '') mot.pop();
    return { motivations: mot.join('\n'), disorders: dis };
  }

  function combine(motivations, disorders) {
    var m = String(motivations || '').replace(/\s+$/, '');
    var d = (disorders || []).filter(Boolean).map(function (x) { return 'Disorder: ' + x; });
    return [m].concat(d).filter(Boolean).join('\n');
  }

  // One line for a table or tooltip: kinds, trigger, effect.
  function describe(name) {
    var d = find(name);
    if (!d) return '';
    return d.kinds.join(' · ') + ' — Trigger: ' + d.trigger + '. ' + d.effect;
  }

  window.dgDisorders = { list: list, find: find, splitText: splitText, combine: combine, describe: describe };
})();
