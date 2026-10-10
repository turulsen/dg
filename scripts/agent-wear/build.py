"""Builds assets/agent-wear.css: the Agent File's paper wearing as SAN falls
(v2 milestone M3). Every texture is an inline SVG (fractal-noise grain,
mottling, foxing, stains, a coffee ring, creases, blood, a torn margin, the
stamp's worn ink), each defined once as a custom property on .as-paper.ap
and stacked by the stages:

  tier 1  SAN 49-40  grain, uneven yellowing, the ink fades
  tier 2  SAN 39-30  + folds, foxing, a coffee ring
  tier 3  SAN 29-20  + water stains, first drops of blood
  tier 4  SAN 19-10  + blood spatter and a smear, the ink bleeds
  tier 5  SAN  9-1   + a torn margin (outside the data), heavier blood
  tier 6  SAN  0     the worst of it

The INSANE stamp shows from SAN 9 (worn, patchy) and fills in from SAN 5 to
solid at 0; assets/agent-paper.js sets data-sanity-tier, --insane and --fill.

Run:  python3 scripts/agent-wear/build.py   (rewrites assets/agent-wear.css)
"""
import os
import random, urllib.parse, math
def uri(svg): return "url(\"data:image/svg+xml," + urllib.parse.quote(svg) + "\")"
def blob(r, cx, cy, R, k=None, wob=(.6,1.35)):
    k=k or r.randint(8,13); pts=[]
    for i in range(k):
        a=i/k*6.283+r.uniform(-.2,.2); rr=R*r.uniform(*wob)
        pts.append((cx+math.cos(a)*rr, cy+math.sin(a)*rr))
    d=f"M{(pts[0][0]+pts[-1][0])/2:.1f} {(pts[0][1]+pts[-1][1])/2:.1f} "
    for i in range(k):
        p=pts[i]; q=pts[(i+1)%k]; d+=f"Q{p[0]:.1f} {p[1]:.1f} {(p[0]+q[0])/2:.1f} {(p[1]+q[1])/2:.1f} "
    return d+"Z"
SVG='<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">{d}</svg>'

# Paper grain (tileable fractal noise, brown, very light)
def grain(alpha):
    d=(f'<filter id="g" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="3" stitchTiles="stitch"/>'
       f'<feColorMatrix values="0 0 0 0 .32  0 0 0 0 .24  0 0 0 0 .12  0 0 0 {alpha} 0"/></filter><rect width="100%" height="100%" filter="url(#g)"/>')
    return uri(SVG.format(w=300,h=300,d=d))
# Uneven ageing: low-frequency mottling
def mottle(strength, seed):
    d=(f'<filter id="m" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".004 .006" numOctaves="4" seed="{seed}" stitchTiles="stitch"/>'
       f'<feColorMatrix values="0 0 0 0 .55  0 0 0 0 .38  0 0 0 0 .14  {strength*2.4:.2f} 0 0 0 {-strength*.95:.2f}"/></filter><rect width="100%" height="100%" filter="url(#m)"/>')
    return uri(SVG.format(w=1200,h=1200,d=d))
# Foxing: small rust speckles
def foxing(strength, seed):
    # Tiny rust specks, only in a few patches of the sheet.
    d=(f'<filter id="f" x="0" y="0" width="100%" height="100%">'
       f'<feTurbulence type="fractalNoise" baseFrequency=".11" numOctaves="2" seed="{seed}" stitchTiles="stitch" result="hi"/>'
       f'<feColorMatrix in="hi" values="0 0 0 0 .48  0 0 0 0 .28  0 0 0 0 .08  16 0 0 0 -10.6" result="sp"/>'
       f'<feTurbulence type="fractalNoise" baseFrequency=".005" numOctaves="2" seed="{seed+40}" stitchTiles="stitch" result="lo"/>'
       f'<feColorMatrix in="lo" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  {6+strength*2:.1f} 0 0 0 {-(3.6+strength*.5):.2f}" result="pa"/>'
       f'<feComposite in="sp" in2="pa" operator="in"/><feGaussianBlur stdDeviation=".5"/></filter><rect width="100%" height="100%" filter="url(#f)" opacity="{min(1,.55+strength*.35):.2f}"/>')
    return uri(SVG.format(w=900,h=900,d=d))
# Water / tea stains: wobbly shapes with a darker tide line
def stains(seed, n, W=1300):
    r=random.Random(seed); out=['<filter id="w" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".03" numOctaves="2" seed="SEED"/><feDisplacementMap in="SourceGraphic" scale="18"/></filter>'.replace('SEED',str(seed)),
        '<filter id="b"><feGaussianBlur stdDeviation="1.4"/></filter>']
    for _ in range(n):
        cx,cy,R=r.uniform(80,W-80),r.uniform(80,W-80),r.uniform(45,120)
        p=blob(r,cx,cy,R,wob=(.75,1.2))
        out.append(f'<g filter="url(#w)"><path d="{p}" fill="#8a6a30" opacity=".07"/><path d="{p}" fill="none" stroke="#6b4a1e" stroke-width="2.4" opacity=".28" filter="url(#b)"/></g>')
    return uri(SVG.format(w=W,h=W,d=''.join(out)))
# Coffee ring: partial, uneven ring
def ring(seed, W=1300):
    r=random.Random(seed); cx,cy,R=r.uniform(200,W-200),r.uniform(200,W-200),r.uniform(48,60)
    arcs=[]
    for i in range(3):
        a0=r.uniform(0,6.28); a1=a0+r.uniform(1.5,3.0)
        x0,y0=cx+R*math.cos(a0),cy+R*math.sin(a0); x1,y1=cx+R*math.cos(a1),cy+R*math.sin(a1)
        arcs.append(f'<path d="M{x0:.0f} {y0:.0f} A{R:.0f} {R:.0f} 0 0 1 {x1:.0f} {y1:.0f}" stroke="#5e3f14" stroke-width="{r.uniform(2,4.5):.1f}" fill="none" opacity="{r.uniform(.18,.32):.2f}"/>')
    d='<filter id="r"><feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="2" seed="%d"/><feDisplacementMap in="SourceGraphic" scale="5"/><feGaussianBlur stdDeviation=".7"/></filter><g filter="url(#r)">%s<circle cx="%.0f" cy="%.0f" r="%.0f" fill="#8a6a30" opacity=".05"/></g>'%(seed,''.join(arcs),cx,cy,R)
    return uri(SVG.format(w=W,h=W,d=d))
# Creases: soft light/dark pair, slightly kinked
def creases(seed, n, W=1400):
    r=random.Random(seed); out=['<filter id="c"><feGaussianBlur stdDeviation="1.6"/></filter>']
    for _ in range(n):
        horiz=r.random()<.6
        if horiz: x1,y1,x2,y2=-20,r.uniform(50,W-50),W+20,0; y2=y1+r.uniform(-120,120)
        else: x1,y1,x2,y2=r.uniform(50,W-50),-20,0,W+20; x2=x1+r.uniform(-120,120)
        pts=" ".join(f"{x1+(x2-x1)*t+r.uniform(-3,3):.0f},{y1+(y2-y1)*t+r.uniform(-3,3):.0f}" for t in [i/10 for i in range(11)])
        out.append(f'<polyline points="{pts}" fill="none" stroke="#3a2a10" stroke-width="3" opacity=".16" filter="url(#c)" transform="translate(2 2)"/>')
        out.append(f'<polyline points="{pts}" fill="none" stroke="#fffaf0" stroke-width="1.6" opacity=".7" filter="url(#c)"/>')
    return uri(SVG.format(w=W,h=W,d=''.join(out)))
# Blood: ragged-edged drops, satellites, drips, a smear; darker cores
def blood(seed, n, W=1100, big=1.0, smear=0):
    r=random.Random(seed)
    out=['<filter id="bl" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency=".18" numOctaves="2" seed="SEED"/><feDisplacementMap in="SourceGraphic" scale="4"/></filter>'.replace('SEED',str(seed)),
         '<radialGradient id="bg"><stop offset="0" stop-color="#3f0303"/><stop offset=".7" stop-color="#5c0606"/><stop offset="1" stop-color="#7a1010"/></radialGradient>',
         '<filter id="sm"><feGaussianBlur stdDeviation="3"/></filter>']
    for _ in range(n):
        cx,cy=r.uniform(40,W-40),r.uniform(40,W-40); R=r.uniform(3,11)*big
        g=[f'<path d="{blob(r,cx,cy,R)}" fill="url(#bg)" opacity="{r.uniform(.6,.9):.2f}"/>']
        for _ in range(r.randint(4,14)):
            a=r.uniform(0,6.28); dd=R*r.uniform(1.4,4.5); rr=r.uniform(.5,2.4)*big
            g.append(f'<path d="{blob(r,cx+math.cos(a)*dd,cy+math.sin(a)*dd,rr,k=7)}" fill="#5c0606" opacity="{r.uniform(.45,.85):.2f}"/>')
        if r.random()<.35:
            L=R*r.uniform(3,8); wv=R*.32
            g.append(f'<path d="M{cx-wv:.1f} {cy:.1f} C{cx-wv*.6:.1f} {cy+L*.5:.1f} {cx-wv*.3:.1f} {cy+L*.8:.1f} {cx:.1f} {cy+L:.1f} C{cx+wv*.3:.1f} {cy+L*.8:.1f} {cx+wv*.6:.1f} {cy+L*.5:.1f} {cx+wv:.1f} {cy:.1f}Z" fill="#4a0505" opacity=".75"/>')
            g.append(f'<circle cx="{cx:.1f}" cy="{cy+L:.1f}" r="{wv*1.3:.1f}" fill="#4a0505" opacity=".8"/>')
        out.append('<g filter="url(#bl)">'+''.join(g)+'</g>')
    for _ in range(smear):
        cx,cy=r.uniform(100,W-100),r.uniform(100,W-100)
        out.append(f'<ellipse cx="{cx:.0f}" cy="{cy:.0f}" rx="{r.uniform(40,90):.0f}" ry="{r.uniform(6,12):.0f}" fill="#6a0a0a" opacity=".22" filter="url(#sm)" transform="rotate({r.uniform(-30,30):.0f} {cx:.0f} {cy:.0f})"/>')
    return uri(SVG.format(w=W,h=W,d=''.join(out)))
# Torn strips for the margin: a soft, uneven edge (sum of slow waves),
# a few real rips, mostly intact -- not a saw-tooth.
def strip(seed, horiz, L=900, D=14, far=False):
    r=random.Random(seed)
    waves=[(r.uniform(.004,.012), r.uniform(0,6.28), r.uniform(.8,2.2)) for _ in range(3)] + [(r.uniform(.05,.09), r.uniform(0,6.28), .5)]
    rips=[(r.uniform(60,L-60), r.uniform(10,26), r.uniform(D*.6,D*.95)) for _ in range(r.randint(1,3))]
    pts=[]
    for i in range(0, L+1, 3):
        dep=2.2+sum(a*math.sin(i*f*6.283/1+p) for f,p,a in waves)
        for c,w,dd in rips:
            if abs(i-c)<w: dep=max(dep, dd*(1-abs(i-c)/w)**.8)
        pts.append((i, max(0,min(D,dep))))
    if far: pts=[(x, D-y) for x,y in pts]
    if horiz:
        poly=" ".join(f"{x},{y:.1f}" for x,y in pts)+(f" {L},0 0,0" if far else f" {L},{D} 0,{D}")
        return uri(SVG.format(w=L,h=D,d=f'<polygon points="{poly}" fill="#fff"/>'))
    poly=" ".join(f"{y:.1f},{x}" for x,y in pts)+(f" 0,{L} 0,0" if far else f" {D},{L} {D},0")
    return uri(SVG.format(w=D,h=L,d=f'<polygon points="{poly}" fill="#fff"/>'))
# Distressed ink for the stamp (mask: opaque with worn holes and a fainter side)
DISTRESS=uri(SVG.format(w=400,h=160,d=(
  '<filter id="d" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9 .6" numOctaves="3" seed="7" result="n"/>'
  '<feColorMatrix in="n" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -9 0 0 0 5.6" result="speck"/>'
  '<feTurbulence type="fractalNoise" baseFrequency=".012 .02" numOctaves="2" seed="3" result="lo"/>'
  '<feColorMatrix in="lo" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  -4 0 0 0 2.75" result="patch"/>'
  '<feComposite in="speck" in2="patch" operator="in"/></filter><rect width="100%" height="100%" filter="url(#d)"/>')))
SL,SR,ST,SB = strip(11,False), strip(12,False,far=True), strip(13,True), strip(14,True,far=True)


V = {
  'grain': grain(.12), 'mottle': mottle(.55, 3), 'fox': foxing(.8, 4),
  'crA': creases(2, 3), 'crB': creases(5, 5), 'ring': ring(3), 'ring2': ring(6),
  'stA': stains(3, 3), 'stB': stains(5, 5),
  'blA': blood(3, 3, big=.85), 'blB': blood(4, 6, smear=1), 'blC': blood(55, 7, W=1500, big=1.1, smear=2), 'blD': blood(66, 9, W=1500, big=1.3, smear=2),
  'tT': ST, 'tB': SB, 'tL': SL, 'tR': SR, 'ink': DISTRESS,
}
SIZE = {'grain': '300px', 'mottle': '1200px', 'fox': '900px', 'crA': '1400px', 'crB': '1400px', 'ring': '1300px', 'ring2': '1300px',
        'stA': '1300px', 'stB': '1300px', 'blA': '1100px', 'blB': '1100px', 'blC': '1500px', 'blD': '1500px'}
POS = {'blA': '220px 140px', 'blC': '360px 520px', 'blD': '820px 240px', 'ring2': '640px 900px', 'crB': '300px 700px'}
VIGN = 'radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0) 55%, rgba(110,75,25,.10) 85%, rgba(90,55,15,.22) 100%)'
def tone(a, b): return f'linear-gradient(rgba(170,128,50,{a}),rgba(140,100,38,{b}))'
def stack(names, extra):
    imgs = [f'var(--w-{n})' for n in names] + extra
    sizes = [f'{SIZE[n]} {SIZE[n]}' for n in names] + ['100% 100%'] * len(extra)
    pos = [POS.get(n, '0 0') for n in names] + ['0 0'] * len(extra)
    return f'background-image:{",".join(imgs)}; background-size:{",".join(sizes)}; background-position:{",".join(pos)};'
TIERS = {
  1: (['grain', 'mottle'], [VIGN, tone(.05, .08)], '#2a2212', '#5a4f36', ''),
  2: (['crA', 'ring', 'fox', 'grain', 'mottle'], [VIGN, tone(.08, .12)], '#332a17', '#62563c', ''),
  3: (['blA', 'crA', 'stA', 'ring', 'fox', 'grain', 'mottle'], [VIGN, tone(.11, .16)], '#3a301b', '#6a5d42', ''),
  4: (['blB', 'blA', 'crA', 'crB', 'stA', 'ring', 'fox', 'grain', 'mottle', 'mottle'], [VIGN, tone(.14, .2)], '#40351e', '#716347', '0 0 1px rgba(40,25,5,.5), 1px 1px 2px rgba(60,40,10,.25)'),
  5: (['blC', 'blB', 'blA', 'crA', 'crB', 'stA', 'stB', 'ring', 'fox', 'fox', 'grain', 'grain', 'mottle', 'mottle'], [VIGN, tone(.17, .25)], '#463a21', '#786a4c', '0 0 1px rgba(40,25,5,.55), 1px 1px 3px rgba(60,40,10,.3)'),
  6: (['blD', 'blC', 'blB', 'blA', 'crA', 'crB', 'stA', 'stB', 'ring', 'ring2', 'fox', 'fox', 'grain', 'grain', 'mottle', 'mottle'], [VIGN, tone(.2, .3)], '#4d4026', '#807155', '0 0 1px rgba(40,25,5,.6), 1px 1px 3px rgba(80,10,10,.35)'),
}
P = '.as-paper.ap'
css = ['/* GENERATED by scripts/agent-wear/build.py -- edit that, not this.',
       '   The Agent File wears as SAN falls (see the script for the stages). */',
       '@property --insane{ syntax:"<number>"; inherits:true; initial-value:0; }',
       '@property --fill{ syntax:"<number>"; inherits:true; initial-value:0; }',
       P + '[data-sanity-tier]{ ' + ' '.join(f'--w-{k}:{v};' for k, v in V.items()) + ' position:relative; isolation:isolate; transition:--insane 1.2s ease, --fill 1.2s ease; }',
       P + '[data-sanity-tier]::before{ content:""; position:absolute; inset:0; pointer-events:none; z-index:5; mix-blend-mode:multiply; background-repeat:repeat; }']
for t, (names, extra, ink, ink2, shadow) in TIERS.items():
    sel = f'{P}[data-sanity-tier="{t}"]'
    css.append(f'{sel}{{ --as-ink:{ink}; --as-ink-2:{ink2}; }}')
    css.append(f'{sel}::before{{ {stack(names, extra)} }}')
    if shadow: css.append(f'{sel} .as-name, {sel} .ap-cur{{ text-shadow:{shadow}; }}')
# Torn margin: 14px of its own, so no data is cut.
tm = ('linear-gradient(#000,#000) padding-box, var(--w-tT) top/900px 14px repeat-x border-box, var(--w-tB) bottom/900px 14px repeat-x border-box, '
      'var(--w-tL) left/14px 900px repeat-y border-box, var(--w-tR) right/14px 900px repeat-y border-box')
css.append(f'{P}[data-sanity-tier="5"], {P}[data-sanity-tier="6"]{{ border:14px solid transparent; margin:-14px; -webkit-mask:{tm}; mask:{tm}; }}')
css.append(f'{P}[data-sanity-tier="5"]::before, {P}[data-sanity-tier="6"]::before{{ inset:-14px; }}')
# The stamp: the page's typewriter face, worn ink that fills in as --fill rises.
ink = 'var(--w-ink) 0 0/400px 160px, linear-gradient(rgba(0,0,0,var(--fill)),rgba(0,0,0,var(--fill)))'
css.append(f'{P}[data-sanity-tier="5"]::after, {P}[data-sanity-tier="6"]::after{{ content:"INSANE"; position:absolute; left:50%; top:150px; z-index:6; pointer-events:none; '
           f'transform:translateX(-50%) rotate(-11deg); padding:2px 22px 0; font-family:"Special Elite","Courier New",monospace; font-size:clamp(40px,13cqw,84px); line-height:1.15; letter-spacing:.14em; '
           f'color:#9c1010; border:7px double #9c1010; border-radius:6px; opacity:var(--insane); mix-blend-mode:multiply; -webkit-mask:{ink}; mask:{ink}; filter:blur(.3px); }}')
# A new stage fades in; none of it with reduced motion, or when switched off in Settings.
css.append('@keyframes ap-wear-in{ from{ opacity:0; } to{ opacity:1; } }')
css.append(f'{P}.ap-wear-change::before{{ animation:ap-wear-in 1.6s ease both; }}')
css.append('@media (prefers-reduced-motion:reduce){ ' + f'{P}.ap-wear-change::before{{ animation:none; }} {P}[data-sanity-tier]{{ transition:none; }} }}')
css.append(f'html.dg-no-wear {P}[data-sanity-tier]::before, html.dg-no-wear {P}[data-sanity-tier]::after{{ display:none; }}')
css.append(f'html.dg-no-wear {P}[data-sanity-tier="5"], html.dg-no-wear {P}[data-sanity-tier="6"]{{ border:0; margin:0; -webkit-mask:none; mask:none; }}')
root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
open(os.path.join(root, 'assets', 'agent-wear.css'), 'w').write('\n'.join(css) + '\n')
print('assets/agent-wear.css', sum(len(c) for c in css), 'bytes')
