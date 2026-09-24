# -*- coding: utf-8 -*-
import json, math
W,H=1600,640
# trace geometry (viewBox units). one beat + start of next
def bump(t,c,w,a): return a*math.exp(-((t-c)**2)/(2*w*w))
def ecg(t):  # t in ms 0..1300 -> mV
    v=bump(t,200,24,0.18)                     # P
    v+=-bump(t,368,5,0.12)+bump(t,380,7,1.0)-bump(t,394,5,0.25)  # QRS
    v+=bump(t,600,42,0.3)                     # T
    # next beat P
    v+=bump(t,1100,24,0.18)
    v+=-bump(t,1268,5,0.12)+bump(t,1280,7,1.0)-bump(t,1294,5,0.25)
    return v
x0,x1=60,1560; y_base=380; scale=220
def X(t): return x0+(x1-x0)*t/1300.0
def Y(v): return y_base-v*scale
pts=' '.join(f'{X(t):.1f},{Y(ecg(t)):.1f}' for t in range(0,1301,2))
grid=[]
for gx in range(x0, x1+1, 30): grid.append(f'<line x1="{gx}" y1="40" x2="{gx}" y2="520" stroke="#f3b9b9" stroke-width="{1.6 if (gx-x0)%150==0 else 0.6}"/>')
for gy in range(40, 521, 30): grid.append(f'<line x1="{x0}" y1="{gy}" x2="{x1}" y2="{gy}" stroke="#f3b9b9" stroke-width="{1.6 if (gy-40)%150==0 else 0.6}"/>')
# labels of waves
lab=lambda t,y,s: f'<text x="{X(t):.0f}" y="{y}" font-family="Assistant,Arial" font-size="30" font-weight="700" fill="#555" text-anchor="middle">{s}</text>'
labels=[lab(200,120,'P'),lab(380,80,'R'),lab(360,470,'Q'),lab(398,470,'S'),lab(600,120,'T'),lab(1100,120,'P')]
# interval bars (below)
def bar(t1,t2,y,txt,col):
    return (f'<line x1="{X(t1):.0f}" y1="{y}" x2="{X(t2):.0f}" y2="{y}" stroke="{col}" stroke-width="4"/>'
            f'<line x1="{X(t1):.0f}" y1="{y-10}" x2="{X(t1):.0f}" y2="{y+10}" stroke="{col}" stroke-width="3"/>'
            f'<line x1="{X(t2):.0f}" y1="{y-10}" x2="{X(t2):.0f}" y2="{y+10}" stroke="{col}" stroke-width="3"/>'
            f'<text x="{(X(t1)+X(t2))/2:.0f}" y="{y+34}" font-family="Assistant,Arial" font-size="24" fill="{col}" text-anchor="middle">{txt}</text>')
bars=[bar(140,355,560,'PR',"#3b6fb6"), bar(355,690,610,'QT',"#b66b3b")]
svg=f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" width="{W}" height="{H}">
<rect width="{W}" height="{H}" fill="#fff8f6"/>
{''.join(grid)}
<polyline points="{pts}" fill="none" stroke="#1d1d1d" stroke-width="3.2" stroke-linejoin="round"/>
{''.join(labels)}
{''.join(bars)}
</svg>'''
open('assets/img/ecg-strip.svg','w',encoding='utf-8').write(svg)
# regions in % of the image: t-ranges -> x%, y ranges
def R(t1,t2,y1,y2,label): return {'x':round(X(t1)/W*100,1),'y':round(y1/H*100,1),'w':round((X(t2)-X(t1))/W*100,1),'h':round((y2-y1)/H*100,1),'label':label}
regions=[
 R(140,262,40,520,'גל P'),                # 0
 R(262,355,40,520,'מקטע PQ'),            # 1
 R(355,410,40,520,'קומפלקס QRS'),        # 2
 R(410,540,40,520,'מקטע ST'),            # 3
 R(540,690,40,520,'גל T'),               # 4
 R(690,1040,40,520,'מקטע TP'),           # 5
 R(140,355,535,590,'מרווח PR'),          # 6
 R(355,690,585,640,'מרווח QT'),          # 7
]
json.dump(regions, open('tools/ekronot/ecg_regions.json','w'), ensure_ascii=False)
print('ecg ok', regions[2])
