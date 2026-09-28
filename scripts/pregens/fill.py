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
    # Bonus points: only skills whose value changed from the sheet's own.
    sheet = {s['name']: s for s in raw['skills']}
    for s in p['skills']:
        src = sheet.get(s['name'])
        if src and s['value'] != src['value']:
            v['%s %d' % (s['name'], src['base'])] = str(s['value'])
    # Keep whatever the sheet already says.
    filled = {k for k, x in raw.get('_filled', {}).items() if x}
    return {k: x for k, x in v.items() if k not in filled and x not in (None, '')}


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
