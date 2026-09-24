# -*- coding: utf-8 -*-
"""אילנות יוחסין כ-SVG. כל אילן: רשימת דורות; כל אדם: id, sex(M/F), aff(bool), carrier(bool), dead?; זוגות ואחאים."""
import json
FONT='Assistant,Arial'
SZ=26  # half size
def person(x,y,p,label):
    fill='#1d1d1d' if p.get('aff') else '#ffffff'
    stroke='#1d1d1d'
    if p['sex']=='M':
        s=f'<rect x="{x-SZ}" y="{y-SZ}" width="{2*SZ}" height="{2*SZ}" fill="{fill}" stroke="{stroke}" stroke-width="3"/>'
    else:
        s=f'<circle cx="{x}" cy="{y}" r="{SZ}" fill="{fill}" stroke="{stroke}" stroke-width="3"/>'
    if p.get('carrier') and not p.get('aff'):
        s+=f'<circle cx="{x}" cy="{y}" r="7" fill="#1d1d1d"/>'
    if p.get('dead'):
        s+=f'<line x1="{x-SZ-8}" y1="{y+SZ+8}" x2="{x+SZ+8}" y2="{y-SZ-8}" stroke="{stroke}" stroke-width="3"/>'
    s+=f'<text x="{x}" y="{y+SZ+24}" font-family="{FONT}" font-size="20" fill="#444" text-anchor="middle">{label}</text>'
    return s
def draw(ped, path, W=1000):
    """ped = {'gens':[ [ {id,sex,aff,carrier?}, ... ], ... ], 'mates':[(idA,idB,consang?)], 'kids':[(idA,idB,[ids])]}
       מיקום: כל דור בשורה; x לפי הסדר ברשימה, במרווחים שווים."""
    rows=ped['gens']; H=140*len(rows)+60
    pos={}; out=[]
    roman=['I','II','III','IV']
    for gi,row in enumerate(rows):
        y=80+gi*140
        out.append(f'<text x="30" y="{y+8}" font-family="{FONT}" font-size="26" font-weight="700" fill="#444">{roman[gi]}</text>')
        n=len(row); step=(W-140)/max(n,1)
        for i,p in enumerate(row):
            x=110+step*i+step/2
            pos[p['id']]=(x,y)
    # mates
    for a,b,*c in ped['mates']:
        (xa,ya),(xb,yb)=pos[a],pos[b]
        xl,xr=min(xa,xb),max(xa,xb)
        out.append(f'<line x1="{xl+SZ}" y1="{ya}" x2="{xr-SZ}" y2="{ya}" stroke="#1d1d1d" stroke-width="3"/>')
        if c and c[0]:
            out.append(f'<line x1="{xl+SZ}" y1="{ya+6}" x2="{xr-SZ}" y2="{ya+6}" stroke="#1d1d1d" stroke-width="3"/>')
    # kids
    for a,b,kids in ped['kids']:
        (xa,ya),(xb,yb)=pos[a],pos[b]
        mx=(xa+xb)/2; kx=[pos[k][0] for k in kids]; ky=pos[kids[0]][1]
        out.append(f'<line x1="{mx}" y1="{ya}" x2="{mx}" y2="{ky-70}" stroke="#1d1d1d" stroke-width="3"/>')
        out.append(f'<line x1="{min(kx+[mx])}" y1="{ky-70}" x2="{max(kx+[mx])}" y2="{ky-70}" stroke="#1d1d1d" stroke-width="3"/>')
        for k in kids:
            x,y=pos[k]; out.append(f'<line x1="{x}" y1="{ky-70}" x2="{x}" y2="{y-SZ}" stroke="#1d1d1d" stroke-width="3"/>')
    for row in rows:
        for p in row:
            x,y=pos[p['id']]; out.append(person(x,y,p,p['id']))
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}"><rect width="{W}" height="{H}" fill="#fff"/>'+''.join(out)+'</svg>'
    open(path,'w',encoding='utf-8').write(svg)
P=lambda i,s,aff=False,carrier=False: {'id':i,'sex':s,'aff':aff,'carrier':carrier}
peds={}
# 1 AD — כל דור, שני המינים, אב→בן
peds[1]={'gens':[[P('I-1','M',True),P('I-2','F')],
                 [P('II-1','F',True),P('II-2','M'),P('II-3','M'),P('II-4','F'),P('II-5','M',True),P('II-6','F')],
                 [P('III-1','M',True),P('III-2','F'),P('III-3','F',True),P('III-4','M',True)]],
         'mates':[('I-1','I-2'),('II-1','II-2'),('II-5','II-6')],
         'kids':[('I-1','I-2',['II-1','II-3','II-5']),('II-1','II-2',['III-1','III-2']),('II-5','II-6',['III-3','III-4'])]}
# 2 AR — הורים בריאים בני דודים, 2/4 חולים
peds[2]={'gens':[[P('I-1','M'),P('I-2','F')],
                 [P('II-1','M',True),P('II-2','F'),P('II-3','F',True),P('II-4','M')]],
         'mates':[('I-1','I-2',True)],
         'kids':[('I-1','I-2',['II-1','II-2','II-3','II-4'])]}
# 3 XR — רק זכרים חולים, דרך אימהות בריאות, אין אב→בן
peds[3]={'gens':[[P('I-1','M'),P('I-2','F',carrier=True)],
                 [P('II-1','M',True),P('II-2','F'),P('II-3','F',carrier=True),P('II-4','M'),P('II-5','M')],
                 [P('III-1','F',carrier=True),P('III-2','M'),P('III-3','M',True),P('III-4','F'),P('III-5','M')]],
         'mates':[('I-1','I-2'),('II-1','II-2'),('II-3','II-4')],
         'kids':[('I-1','I-2',['II-1','II-3','II-5']),('II-1','II-2',['III-1','III-2']),('II-3','II-4',['III-3','III-4','III-5'])]}
# 4 XD — אב חולה: כל הבנות חולות, אף בן לא
peds[4]={'gens':[[P('I-1','M',True),P('I-2','F')],
                 [P('II-1','F',True),P('II-2','M'),P('II-3','F',True),P('II-4','M'),P('II-5','M')],
                 [P('III-1','M',True),P('III-2','F'),P('III-3','F',True)]],
         'mates':[('I-1','I-2'),('II-1','II-2')],
         'kids':[('I-1','I-2',['II-1','II-3','II-4','II-5']),('II-1','II-2',['III-1','III-2','III-3'])]}
# 5 מיטוכונדריאלי — אם חולה: כל ילדיה; אב חולה: אף אחד
peds[5]={'gens':[[P('I-1','M'),P('I-2','F',True)],
                 [P('II-1','M',True),P('II-2','F'),P('II-3','F',True),P('II-4','M'),P('II-5','F',True)],
                 [P('III-1','F'),P('III-2','M'),P('III-3','M',True),P('III-4','F',True)]],
         'mates':[('I-1','I-2'),('II-1','II-2'),('II-3','II-4')],
         'kids':[('I-1','I-2',['II-1','II-3','II-5']),('II-1','II-2',['III-1','III-2']),('II-3','II-4',['III-3','III-4'])]}
# 6 Y — רק זכרים, כל בני האב החולה
peds[6]={'gens':[[P('I-1','M',True),P('I-2','F')],
                 [P('II-1','M',True),P('II-2','F'),P('II-3','F'),P('II-4','M',True)],
                 [P('III-1','M',True),P('III-2','F'),P('III-3','M',True)]],
         'mates':[('I-1','I-2'),('II-1','II-2')],
         'kids':[('I-1','I-2',['II-1','II-3','II-4']),('II-1','II-2',['III-1','III-2','III-3'])]}
# 7 AD עם חדירות חלקית — דור מדולג
peds[7]={'gens':[[P('I-1','M',True),P('I-2','F')],
                 [P('II-1','F'),P('II-2','M'),P('II-3','M',True),P('II-4','F')],
                 [P('III-1','M',True),P('III-2','F',True),P('III-3','F'),P('III-4','M')]],
         'mates':[('I-1','I-2'),('II-1','II-2'),('II-3','II-4')],
         'kids':[('I-1','I-2',['II-1','II-3']),('II-1','II-2',['III-1','III-2','III-3']),('II-3','II-4',['III-4'])]}
# 8 AR בלי קרבת משפחה — שתי משפחות לא קשורות, הורים בריאים, בן ובת חולים
peds[8]={'gens':[[P('I-1','M'),P('I-2','F'),P('I-3','M'),P('I-4','F')],
                 [P('II-1','F'),P('II-2','M'),P('II-3','M'),P('II-4','F')],
                 [P('III-1','M',True),P('III-2','F'),P('III-3','F',True),P('III-4','M')]],
         'mates':[('I-1','I-2'),('I-3','I-4'),('II-2','II-3')],
         'kids':[('I-1','I-2',['II-1','II-2']),('I-3','I-4',['II-3','II-4']),('II-2','II-3',['III-1','III-2','III-3','III-4'])]}
for k,v in peds.items(): draw(v, f'assets/img/pedigree-0{k}.svg')
print('pedigrees ok')
