#!/usr/bin/env python3
"""Friendly pregens, step 3 (optional): print-ready sheets.

    python3 scripts/pregens/fill.py <folder-of-pdfs> friendly/pregens.json -o printable/

Writes a copy of each source PDF with build.js's generated details filled
into the blanks (name, nationality, sex, age/DOB, education, physical
description, distinguishing features, Bond names, Motivations, bonus
skill values, current HP/WP), so the paper sheet a Friendly player
writes HP and SAN on matches the one on screen. Fields the sheet already
had are left alone. Output is for printing only -- keep it out of git.
"""
import argparse
import json
import os
import re
import sys

from pypdf import PdfReader, PdfWriter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from extract import extract  # noqa: E402

STATS = ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA']


def values_for(p, raw):
    last, rest = p['name'].split(' ')[-1], ' '.join(p['name'].split(' ')[:-1])
    v = {
        '1 LAST NAME FIRST NAME MIDDLE INITIAL': '%s, %s' % (last.upper(), rest),
        '4 NATIONALITY': p['nationality'],
        '6 AGE AND DOB': '%s (%s)' % (p['age'], p['dob']),
        '7 EDUCATION AND OCCUPATION': p['education'],
        '10 PHYSICAL DESCRIPTION': p['physical'],
        '12 MOTIVATIONS AND MENTAL DISORDERSPSYCHOLOGICAL DATA': '\n'.join(p['motivations']),
        'CURRENTHit Points HP': str(p['derived']['hp']),
        'CURRENTWillpower Points WP': str(p['derived']['wp']),
    }
    # The form's sex row is [ ] F  [ ] M  [ ] ____ : Check Box7/8/9 left to
    # right, the text field only for anything else.
    box = {'Female': 'Check Box7', 'Male': 'Check Box8'}.get(p['sex'], 'Check Box9')
    v[box] = '/Yes'
    if box == 'Check Box9':
        v['SEX'] = p['sex']
    for st in STATS:
        v[st + ' DISTINGUISHING FEATURES'] = p['stats'][st]['feature']
    for i, b in enumerate(p['bonds'][:6], 1):
        v['BOND %d' % i] = '%s (%s)' % (b['name'], b['relationship'])
        v['BOND %d SCORE' % i] = str(b['score'])
    # Identity fields the sheet already filled in stay as printed.
    printed = {k for k, x in raw.get('_filled', {}).items() if x}
    v = {k: x for k, x in v.items() if k not in printed and x not in (None, '')}
    if not raw.get('employer') and p.get('employer'):
        v[raw.get('employer_field') or '3 EMPLOYER'] = p['employer']
    v.update(skill_values(p, raw))
    return v


SPECIALTY_KINDS = ['Art', 'Craft', 'Military Science', 'Pilot', 'Science']
SPEC_RE = re.compile(r'^(Foreign Language|Language|Science|Craft|Art|Military Science|Pilot)\s*(?:\((.*)\))?\s*$', re.I)


def normalize(name):
    """Same naming as build.js splitSpecialty(): 'Language (Spanish)' ->
    ('Foreign Language', 'Spanish'); a blank or '(Choose One)' -> spec ''."""
    m = SPEC_RE.match((name or '').strip())
    if not m:
        return None, name
    kind = m.group(1).title().replace('Of', 'of')
    kind = 'Foreign Language' if kind.lower() in ('language', 'foreign language') else kind
    spec = re.sub(r'_+', '', m.group(2) or '').strip()
    if re.match(r'^\(?choose (one|another|any)\)?$', spec, re.I):
        spec = ''
    return kind, (spec[:1].upper() + spec[1:]) if spec else ''


def slot_label(name):
    """The Other Skills box is narrow and headed 'Foreign Languages and
    Other Skills' -- a language goes in as just its name."""
    m = re.match(r'^Foreign Language \((.+)\)$', name)
    return m.group(1) if m else name


def skill_values(p, raw):
    """Every skill value the build changed or added, in the form's own
    boxes: a plain skill's box, the one specialty line per kind, or the
    six 'Foreign Languages and Other Skills' slots."""
    gen = {s['name']: s['value'] for s in p['skills']}
    used, out = set(), {}
    # build.js names the form's blank lines in form order -- specialty
    # lines first, then the Other Skills slots -- and lists them in
    # p['filled'] in that same order, so walking the form in that order
    # pairs each blank with its name (a value can't: bonus points move it).
    filled = list(p.get('filled') or [])

    def take(kind, spec, value):
        if spec:
            name = '%s (%s)' % (kind, spec)
            return name if name in gen else None
        name = filled.pop(0) if filled else None
        return name if name in gen else None

    for s in raw['skills']:
        if s['name'] in gen:
            used.add(s['name'])
            if gen[s['name']] != s['value']:
                out['%s %d' % (s['name'], s['base'])] = str(gen[s['name']])
    spec_line = {x['kind']: x for x in raw['specialties']}
    for kind in SPECIALTY_KINDS:
        line = spec_line.get(kind)
        name = None
        if line:
            k, spec = normalize('%s (%s)' % (kind, line['name'] or ''))
            name = take(kind, spec, line['value'] or 0)
        else:  # an empty line: room for a specialty the build chose
            name = next((n for n in gen if n.startswith(kind + ' (') and n not in used), None)
        if name:
            used.add(name)
            out[kind] = name[len(kind) + 2:-1]
            out[kind + ' 0'] = str(gen[name])
    taken_slots = set()
    for o in raw['other_skills']:
        kind, spec = normalize(o['name'])
        name = take(kind, spec, o['value'] or 0) if kind else (o['name'] if o['name'] in gen else None)
        taken_slots.add(o['slot'])
        if name:
            used.add(name)
            out['Foreign Languages and Other Skills %d' % o['slot']] = slot_label(name)
            out['Foreign Languages and Other Skills %d Score' % o['slot']] = str(gen[name])
    free = [i for i in range(1, 7) if i not in taken_slots]
    for name, val in sorted(gen.items()):
        if name in used or val <= 0 or not free:
            continue
        slot = free.pop(0)
        out['Foreign Languages and Other Skills %d' % slot] = slot_label(name)
        out['Foreign Languages and Other Skills %d Score' % slot] = str(val)
        used.add(name)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder')
    ap.add_argument('pregens')
    ap.add_argument('-o', '--out', default='printable')
    args = ap.parse_args()
    by_title = {p['title']: p for p in json.load(open(args.pregens, encoding='utf-8'))['pregens']}
    os.makedirs(args.out, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(args.folder)):
        if not f.lower().endswith('.pdf'):
            continue
        path = os.path.join(args.folder, f)
        try:
            raw = extract(path)
        except Exception:
            continue
        p = by_title.get(raw['title'])
        if not p:
            continue
        reader = PdfReader(path)
        raw['_filled'] = {k: (fv.get('/V') not in (None, '', '/Off')) for k, fv in (reader.get_fields() or {}).items()}
        writer = PdfWriter()
        writer.append(reader)
        vals = values_for(p, raw)
        for page in writer.pages:
            writer.update_page_form_field_values(page, vals, auto_regenerate=False)
        writer.set_need_appearances_writer(True)
        out = os.path.join(args.out, '%s - %s.pdf' % (raw['title'], p['name']))
        with open(out, 'wb') as fh:
            writer.write(fh)
        n += 1
        print('  %s -> %s (%d fields)' % (f, os.path.basename(out), len(vals)))
    print('%d printable sheets in %s' % (n, args.out))


if __name__ == '__main__':
    main()
