"""Natural Earth documentary maps on the same cached PNG/GPU path as other graphics."""
import json
import math
from functools import lru_cache
from PIL import Image,ImageDraw
from app.core.config import settings
from app.services.chart_graphics import _frame,_fit,_smooth,_partial,least

def projection(lon,lat):return (lon+180)/360,.5-math.log(math.tan(math.pi/4+math.radians(max(-85,min(85,lat)))/2))/(2*math.pi)

@lru_cache(maxsize=4)
def outlines(path,mtime):
    data=json.loads(path.read_text());answer=[]
    for feature in data['features']:
        geometry=feature.get('geometry') or {};kind=geometry.get('type');coords=geometry.get('coordinates') or []
        polygons=coords if kind=='MultiPolygon' else [coords] if kind=='Polygon' else []
        properties=feature.get('properties') or {};name=properties.get('ADMIN') or properties.get('name') or ''
        for polygon in polygons:
            for ring in polygon:
                if len(ring)<3:continue
                stride=max(1,len(ring)//700);points=[projection(float(lon),float(lat)) for lon,lat,*_ in ring[::stride]]
                if points[-1]!=points[0]:points.append(points[0])
                answer.append((name,points,(min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points))))
    return answer

def bounds(graphic,progress):
    region={'world':(-180,-60,180,80),'india':(66,5,99,38),'tamil-nadu':(75.8,7.5,81,14)}[graphic.map_region]
    lon0,lat0,lon1,lat1=region
    if graphic.map_region!='world':
        for place in graphic.map_places:
            lon0=min(lon0,place.lon-1);lon1=max(lon1,place.lon+1);lat0=min(lat0,place.lat-1);lat1=max(lat1,place.lat+1)
    x0,y1=projection(lon0,lat0);x1,y0=projection(lon1,lat1);target=(x0,y0,x1,y1)
    start_region=(66,5,99,38) if graphic.map_region=='tamil-nadu' else (-180,-60,180,80)
    a,b,c,d=start_region;u0,v1=projection(a,b);u1,v0=projection(c,d)
    q=min(1,progress/.58) if graphic.map_zoom else 1;q=1-(1-q)**3
    return tuple(a+(b-a)*q for a,b in zip((u0,v0,u1,v1),target))

def _draw_map(item,fmt,progress):
    graphic,image,draw,(left,top,right,bottom),_,main,accent=_frame(item,fmt)
    path=settings.data_dir/'maps'/'countries.geojson'
    if not path.is_file():raise ValueError('Install map outlines in Travel map first. This graphic never downloads data automatically.')
    country=outlines(path,path.stat().st_mtime_ns)
    states_path=path.with_name('states.geojson');states=outlines(states_path,states_path.stat().st_mtime_ns) if states_path.is_file() else []
    x0,y0,x1,y1=bounds(graphic,progress);pad=max(10,round(fmt.height*.035));plot=(left+pad,top+pad,right-pad,bottom-pad)
    scale=min((plot[2]-plot[0])/(x1-x0),(plot[3]-plot[1])/(y1-y0));cx=(plot[0]+plot[2])/2;cy=(plot[1]+plot[3])/2
    def xy(p):return (round(cx+(p[0]-(x0+x1)/2)*scale),round(cy+(p[1]-(y0+y1)/2)*scale))
    land=Image.new('RGBA',image.size);pen=ImageDraw.Draw(land)
    for name,points,box in country+states:
        if box[2]<x0 or box[0]>x1 or box[3]<y0 or box[1]>y1:continue
        pixels=[xy(p) for p in points];important=name in ('India','Tamil Nadu')
        pen.polygon(pixels,fill=(*main[:3],35 if important else 14))
        pen.line(pixels,fill=accent if name=='Tamil Nadu' and graphic.map_region=='tamil-nadu' else (*main[:3],220 if important else 100),width=max(1,round(fmt.height*(.002 if important else .001))))
    # Crop outlines and labels to the graphic itself, including when zoomed deeply into a region.
    positions=[xy(projection(p.lon,p.lat)) for p in graphic.map_places]
    if graphic.map_route and len(positions)>1:
        route=_partial(positions,max(0,min(1,(progress-.55)/.4)))
        if len(route)>1:pen.line(route,fill=accent,width=max(3,round(graphic.line_width*fmt.height)),joint='curve')
    size=max(18,least(fmt),round(item.size*fmt.height/1080));radius=max(5,round(fmt.height*.009))
    for index,(place,(x,y)) in enumerate(zip(graphic.map_places,positions)):
        q=max(0,min(1,(progress-.5-index*.035)/.18))
        if not q or not plot[0]<=x<=plot[2] or not plot[1]<=y<=plot[3]:continue
        r=max(1,round(radius*q));pen.ellipse((x-r,y-r,x+r,y+r),fill=main)
        room=max(20,min((right-left)*.38,plot[2]-plot[0]));font,box,label=_fit(pen,place.name,size,int(room),round(fmt.height*.08),max(18,least(fmt)))
        tw,th=box[2]-box[0],box[3]-box[1];tx=max(plot[0],min(plot[2]-tw,x+radius*2));ty=max(plot[1],min(plot[3]-th,y-th-radius*2 if index%2==0 else y+radius*2))
        pen.rounded_rectangle((tx-3,ty-2,tx+tw+3,ty+th+2),radius=3,fill=(16,20,27,220))
        pen.text((tx-box[0],ty-box[1]),label,font=font,fill=main)
    cropped=land.crop((left,top,right+1,bottom+1));image.alpha_composite(cropped,(left,top))
    return image

def render_map(item,fmt,progress):
    image=_smooth(_draw_map,item,fmt,progress)
    # The shared Clean shadow is also clipped, so a region touching an edge cannot leak outside its own box.
    _,_,_,(left,top,right,bottom),_,_,_=_frame(item,fmt)
    result=Image.new('RGBA',image.size);result.alpha_composite(image.crop((left,top,right+1,bottom+1)),(left,top))
    return result
