#!/usr/bin/env python3
"""Friendly pregens, step 1: read fillable DD Form 315 PDFs into raw JSON.

    python3 scripts/pregens/extract.py <folder-of-pdfs> -o pregens-raw.json

Reads every *.pdf in the folder (the Agent Dossiers package), pulls the
AcroForm fields out, and writes one record per sheet plus a `missing`
list naming every field the sheet left blank -- the things
build.js then generates (name, sex, age, nationality, bonds...).

The output holds the sheets' own text (gear, notes) verbatim, so it is
a LOCAL working file: keep it out of git (see .gitignore). Only
build.js's output (friendly/pregens.json) is published.

Needs pypdf (`pip install pypdf`).
"""
import argparse
import json
import os
import re
import sys

from pypdf import PdfReader

STATS = ['STR', 'CON', 'DEX', 'INT', 'POW', 'CHA']
SPECIALTIES = ['Art', 'Craft', 'Military Science', 'Pilot', 'Science']
# "Skill base" is the field name for every plain skill on the form, e.g.
# 'Alertness 20'; specialties are a text field plus a 'Name 0' value.
SKILL_FIELD = re.compile(r'^([A-Za-z][A-Za-z ]*?) (\d+)$')


def val(fields, key):
    f = fields.get(key)
    if not f:
        return ''
    v = f.get('/V')
    if v is None:
        return ''
    v = str(v)
    if v in ('/Off', 'Off'):
        return ''
    # The form stores paragraph breaks as bare \r.
    return v.replace('\r\n', '\n').replace('\r', '\n').strip()


def num(s):
    m = re.search(r'-?\d+', s or '')
    return int(m.group(0)) if m else None


SMALL_WORDS = {'and', 'or', 'of', 'the', 'a'}


def slug(title):
    """'USSS - Personal Protective Detail' -> 'USSS-PPD', 'Police Officer'
    -> 'PO': short enough to read in a Cell's member list, and a valid
    Agent Code shape for exchangeAgentToken (A-Z, 0-9, dash)."""
    parts = []
    for part in re.split(r'\s+-\s+', title):
        words = [w for w in re.findall(r'[A-Za-z0-9]+', part) if w.lower() not in SMALL_WORDS]
        if len(words) == 1:
            parts.append(words[0][:12])
        elif all(w.isupper() for w in words):  # 'CIA SAD-SOG'
            parts.append('-'.join(words))
        else:
            parts.append(''.join(w if w[0].isdigit() or w.isupper() else w[0] for w in words))
    return '-'.join(p for p in parts if p).upper()[:28]


def extract(path):
    fields = PdfReader(path).get_fields() or {}
    title = os.path.splitext(os.path.basename(path))[0]
    title = re.sub(r'^[0-9a-f]{8}-', '', title)  # chat-upload prefix
    title = title.replace('_', ' ').replace('  ', ' ').strip()
    rec = {
        'file': os.path.basename(path),
        'title': title,
        'id': 'FR-' + slug(title),
        'profession': val(fields, '2 PROFESSION RANK IF APPLICABLE'),
        'employer': val(fields, '3 EMPLOYER'),
        'name': val(fields, '1 LAST NAME FIRST NAME MIDDLE INITIAL'),
        'nationality': val(fields, '4 NATIONALITY'),
        'sex': val(fields, 'SEX'),
        'age_dob': val(fields, '6 AGE AND DOB'),
        'education': val(fields, '7 EDUCATION AND OCCUPATION'),
        'physical': val(fields, '10 PHYSICAL DESCRIPTION'),
        'motivations': val(fields, '12 MOTIVATIONS AND MENTAL DISORDERSPSYCHOLOGICAL DATA'),
        'wounds': val(fields, '14 WOUNDS AND AILMENTS_2'),
        'gear': val(fields, '15 ARMOR AND GEAR'),
        'notes': val(fields, '17 PERSONAL DETAILS AND NOTES'),
        'developments': val(fields, '18 DEVELOPMENTS WHICH AFFECT HOME AND FAMILY'),
        'stats': {}, 'features': {}, 'bonds': [], 'skills': [],
        'specialties': [], 'other_skills': [], 'weapons': [], 'special_training': [],
    }
    for st in STATS:
        rec['stats'][st] = num(val(fields, st))
        rec['features'][st] = val(fields, st + ' DISTINGUISHING FEATURES')
    for i in range(1, 7):
        name, score = val(fields, 'BOND %d' % i), val(fields, 'BOND %d SCORE' % i)
        if name or score:
            rec['bonds'].append({'name': name, 'score': num(score)})
    rec['derived'] = {
        'hp': num(val(fields, 'MAXIMUMHit Points HP')),
        'wp': num(val(fields, 'MAXIMUMWillpower Points WP')),
        'san_max': num(val(fields, 'MAXIMUMSanity Points SAN')),
        'san': num(val(fields, 'CURRENTSanity Points SAN')),
        'bp': num(val(fields, 'CURRENTBreaking Point BP')),
    }
    for key in fields:
        m = SKILL_FIELD.match(key)
        if not m or m.group(1) in STATS:
            continue
        name, base = m.group(1), int(m.group(2))
        if name in SPECIALTIES:
            label = val(fields, name)
            v = num(val(fields, key))
            if label or v:
                rec['specialties'].append({'kind': name, 'name': label, 'value': v})
            continue
        if name.startswith(('BOND', 'Check Box', 'Foreign Languages')):
            continue
        v = num(val(fields, key))
        rec['skills'].append({'name': name, 'base': base, 'value': v if v is not None else base})
    for i in range(1, 7):
        name = val(fields, 'Foreign Languages and Other Skills %d' % i)
        score = num(val(fields, 'Foreign Languages and Other Skills %d Score' % i))
        if name or score:
            rec['other_skills'].append({'name': name, 'value': score})
    for c in 'abcdefg':
        w = {
            'name': val(fields, 'WEAPON' + c),
            'skill': num(val(fields, 'SKILL ' + c)),
            'range': val(fields, 'BASE RANGE' + c),
            'damage': val(fields, 'DAMAGE' + c),
            'ap': val(fields, 'ARMOR PIERCING' + c),
            'kill_damage': val(fields, 'KILL DAMAGE' + c),
            'kill_radius': val(fields, 'KILL RADIUS' + c),
            'ammo': val(fields, 'AMMO ' + c),
        }
        if w['name']:
            rec['weapons'].append(w)
    for c in 'abcdef':
        t, s = val(fields, 'SPECIAL TRAINING' + c), val(fields, 'SKILL OR STAT' + c)
        if t or s:
            rec['special_training'].append({'training': t, 'skill': s})

    missing = []
    for k in ('name', 'nationality', 'sex', 'age_dob', 'education', 'physical', 'motivations'):
        if not rec[k]:
            missing.append(k)
    if not any(rec['features'].values()):
        missing.append('features')
    if not rec['bonds'] or not any(b['name'] for b in rec['bonds']):
        missing.append('bond_names')
    for st in STATS:
        if rec['stats'][st] is None:
            missing.append('stat:' + st)
    rec['missing'] = missing
    return rec


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('folder')
    ap.add_argument('-o', '--out', default='pregens-raw.json')
    args = ap.parse_args()
    pdfs = sorted(f for f in os.listdir(args.folder) if f.lower().endswith('.pdf'))
    out, skipped, ids = [], [], set()
    for f in pdfs:
        try:
            rec = extract(os.path.join(args.folder, f))
        except Exception as e:  # a non-form PDF (e.g. the package instructions)
            skipped.append('%s (%s)' % (f, e))
            continue
        if not rec['profession'] and rec['stats']['STR'] is None:
            skipped.append('%s (no DD 315 form fields)' % f)
            continue
        base, n = rec['id'], 2
        while rec['id'] in ids:  # two titles with the same initials
            rec['id'] = '%s-%d' % (base, n)
            n += 1
        ids.add(rec['id'])
        out.append(rec)
    with open(args.out, 'w', encoding='utf-8') as fh:
        json.dump(out, fh, indent=1, ensure_ascii=False)
    print('%d sheets -> %s' % (len(out), args.out))
    for rec in out:
        print('  %-40s missing: %s' % (rec['title'][:40], ', '.join(rec['missing']) or '-'))
    for s in skipped:
        print('  skipped: ' + s, file=sys.stderr)


if __name__ == '__main__':
    main()
