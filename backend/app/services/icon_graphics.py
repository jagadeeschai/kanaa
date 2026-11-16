"""Nine original vector-like stickers drawn in Pillow; no downloaded assets or licences."""
import math
from PIL import Image, ImageDraw
from app.services.chart_graphics import _frame, _partial, _smooth

ICONS = ('pin','warning','tick','cross','question','star','heart','trend-up','trend-down')


def arc(cx,cy,rx,ry,start,end,count=48):
    return [(cx+rx*math.cos(math.radians(start+(end-start)*i/count)),cy+ry*math.sin(math.radians(start+(end-start)*i/count))) for i in range(count+1)]


def paths(kind):
    if kind == 'tick': return [[(.18,.52),(.4,.75),(.82,.25)]]
    if kind == 'cross': return [[(.24,.24),(.76,.76)],[(.76,.24),(.24,.76)]]
    if kind == 'warning': return [[(.5,.16),(.87,.8),(.13,.8),(.5,.16)],[(.5,.37),(.5,.57)],[(.5,.68),(.5,.69)]]
    if kind == 'question': return [arc(.5,.37,.2,.19,180,365)+[(.52,.61)],[(.5,.76),(.5,.77)]]
    if kind == 'pin': return [arc(.5,.38,.24,.24,150,390)+[(.5,.86),(.292,.5)],arc(.5,.38,.075,.075,0,360)]
    if kind == 'star':
        p=[(.5+(.36 if i%2==0 else .16)*math.cos(-math.pi/2+i*math.pi/5),.5+(.36 if i%2==0 else .16)*math.sin(-math.pi/2+i*math.pi/5)) for i in range(10)]
        return [p+[p[0]]]
    if kind == 'heart':
        p=[]
        for i in range(97):
            t=i*math.pi*2/96; p.append((.5+16*math.sin(t)**3*.021,.47-(13*math.cos(t)-5*math.cos(2*t)-2*math.cos(3*t)-math.cos(4*t))*.021))
        return [p]
    if kind in ('trend-up','trend-down'):
        p=[(.16,.74),(.4,.49),(.56,.6),(.84,.26)]
        arrow=[(.6,.26),(.84,.26),(.84,.51)]
        if kind=='trend-down': p=[(x,1-y) for x,y in p]; arrow=[(x,1-y) for x,y in arrow]
        return [p,arrow]
    raise ValueError('Choose a built-in icon.')


def _draw_icon(item,fmt,progress):
    graphic,_,_,(left,top,right,bottom),panel,main,accent=_frame(item,fmt)
    image=Image.new('RGBA',(fmt.width,fmt.height)); draw=ImageDraw.Draw(image)
    size=min(right-left,bottom-top); x=(left+right-size)/2; y=(top+bottom-size)/2
    if graphic.icon_badge:
        draw.ellipse((x+size*.02,y+size*.02,x+size*.98,y+size*.98),fill=panel or (24,27,32,220),outline=accent if graphic.style in ('documentary','bold-colour') else main,width=max(2,round(size*.025)))
    stroke=max(3,round(size*.065)); shapes=paths(graphic.icon); count=len(shapes)
    for index,shape in enumerate(shapes):
        q=max(0,min(1,progress*count-index))
        if q<=0: continue
        points=[(round(x+u*size),round(y+v*size)) for u,v in shape]
        shown=_partial(points,q)
        if len(shown)>1:
            draw.line(shown,fill=main,width=stroke,joint='curve')
            r=stroke/2
            for px,py in (shown[0],shown[-1]): draw.ellipse((px-r,py-r,px+r,py+r),fill=main)
    return image


def render_icon(item,fmt,progress): return _smooth(_draw_icon,item,fmt,progress)
