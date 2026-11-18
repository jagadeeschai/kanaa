"""Panel geometry shared with timeline/split-transition.ts. Coordinates are top-left frame pixels.

Frame k of n uses p=k/n. Two-pixel boundaries and offsets align the 4:2:0 chroma grid in both encoders.
"""
import math

def panels(p, n=2, direction='horizontal', width=1920, height=1080, style='clean'):
    if n not in (2,3,4) or direction not in ('horizontal','vertical','diagonal') or style not in ('clean','gap','shadow'):
        raise ValueError('Choose 2–4 panels, a split direction and a split style.')
    p=max(0,min(1,p));e=p*p*(3-2*p);vertical=direction=='vertical';span=height if vertical else width
    result=[]
    for i in range(n):
        lo=2*math.floor(i*span/n/2);hi=2*math.floor((i+1)*span/n/2);sign=-1 if i<(n-1)/2 else 1 if i>(n-1)/2 else 0
        extra=max(0,abs(i-(n-1)/2)-(1 if n%2 else .5))
        travel_x=2*math.ceil((width+extra*width/n)/2);travel_y=2*math.ceil((height+extra*height/n)/2)
        dx=0 if vertical else sign*travel_x*e;dy=sign*travel_y*e if vertical or direction=='diagonal' else 0
        if not sign:dy=-height*e
        result.append({'rect':[0,lo,width,hi-lo] if vertical else [lo,0,hi-lo,height],
                       'move':[2*math.floor(dx/2+.5),2*math.floor(dy/2+.5),1-e if not sign else 1,2*math.ceil(e*max(1,min(width,height)*.006)/2) if style=='gap' else 0]})
    return result

def build(moves,a,b,transition):
    """Crop the outgoing stream, then move each panel over the incoming stream with eval=frame."""
    n=transition.split_panels;style=transition.split_style;w,h=moves.width,moves.height
    geometry=panels(0,n,transition.split_direction,w,h,style);copies=moves.copies(a,n);base=b
    q=f'(N/{moves.frames})';e=f'({q}*{q}*(3-2*{q}))';qt=f'(t*{moves.fps}/{moves.frames})';et=f'({qt}*{qt}*(3-2*{qt}))'
    for i,(part,source) in enumerate(zip(geometry,copies)):
        x,y,pw,ph=part['rect'];end=panels(1,n,transition.split_direction,w,h,style)[i]['move'];middle=i==(n-1)/2
        opacity=f'(1-{e})' if middle else '1';gap=f'(2*ceil({e}*{max(1,min(w,h)*.006)}/2))' if style=='gap' else '0'
        # Keep secondary states 10 microseconds early so AVTB rounding cannot select the preceding frame.
        panel=moves.label('panel');alpha=f"alpha(X,Y)*{opacity}*gte(X,{gap if x>0 else 0})*lt(X,{pw}-({gap if x+pw<w else 0}))*gte(Y,{gap if y>0 else 0})*lt(Y,{ph}-({gap if y+ph<h else 0}))"
        moves.lines.append(f"[{source}]crop={pw}:{ph}:{x}:{y},format=gbrap,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='{alpha}',settb=AVTB,setpts=PTS-10[{panel}]")
        ox=f'{x}+2*floor({end[0]}*{et}/2+.500001)';oy=f'{y}+2*floor({end[1]}*{et}/2+.500001)'
        if style=='shadow':
            radius=max(2,round(h*.012));shadow=moves.label('shadow');distance=f'max(max({radius}-X,X-{radius+pw-1}),max({radius}-Y,Y-{radius+ph-1}))'
            shade=f'255*.22*{e}*{opacity}*pow(max(0,1-max(0,{distance})/{radius}),2)'
            moves.lines.append(f"color=black@0:s={pw+2*radius}x{ph+2*radius}:r={moves.fps},format=gbrap,trim=end_frame={moves.frames},geq=r=0:g=0:b=0:a='{shade}',settb=AVTB,setpts=PTS-10[{shadow}]")
            out=moves.label('shade');moves.lines.append(f"[{base}][{shadow}]overlay=x='{ox}-{radius}':y='{oy}-{radius}':eval=frame:format=gbrp:eof_action=pass[{out}]");base=out
        out=moves.label('over');moves.lines.append(f"[{base}][{panel}]overlay=x='{ox}':y='{oy}':eval=frame:format=gbrp:eof_action=pass[{out}]");base=out
    return base
