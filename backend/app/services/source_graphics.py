"""Source metadata, consistent amber footnotes and an automatically rebuilt end roll."""
import re
from PIL import Image,ImageDraw
from app.services.chart_graphics import _fit,_smooth,clusters,least
from app.services.step_graphics import wrapped

def valid(value):return bool(value and value.strip() and value.strip() not in ('Source: …','Source: ...','Type your source'))

def catalog(data):
    found=[]
    for layer in data['layers']:
        if layer['kind']!='text' or layer.get('hidden') or layer['id'].startswith('__source_'):continue
        for item in sorted(layer['items'],key=lambda i:i['start']):
            value=item['text'] if (item.get('graphic') or {}).get('kind')=='source' else item.get('source')
            if valid(value) and value.strip() not in found:found.append(value.strip())
    return found

def roll_lines(values):
    answer=['Sources / ஆதாரங்கள்'] if values else []
    for index,value in enumerate(values):
        letters=clusters(f'{index+1}. {value}');limit=60 if re.search('[஀-௿]',value) else 100
        answer.extend(''.join(letters[i:i+limit]) for i in range(0,len(letters),limit))
    return answer

def missing_sources(data):
    found=[]
    for layer in data['layers']:
        if layer['kind']!='text' or layer.get('hidden') or layer['id'].startswith('__source_'):continue
        for item in layer['items']:
            graphic=item.get('graphic') or {};kind=graphic.get('kind')
            numeric=kind in ('count-up','bar-chart','line-chart','pie-chart') or (kind!='source' and bool(re.search(r'[\d"“”«»]',item['text'])))
            if numeric and not valid(item.get('source')):found.append({'id':item['id'],'start':item['start'],'text':item['text'][:80]})
    return found

def decorate(timeline):
    from app.services.timeline_schema import Timeline
    if not timeline.sources_roll and not any(layer.kind=='text' and any(valid(item.source) for item in layer.items) for layer in timeline.layers) and not any(layer.id.startswith('__source_') for layer in timeline.layers):return timeline
    data=timeline.model_dump(by_alias=True);data['layers']=[layer for layer in data['layers'] if not layer['id'].startswith('__source_')]
    base=max((item.start+item.length for layer in timeline.layers if not layer.id.startswith('__source_') for item in layer.items),default=0)
    source_items=[item for layer in data['layers'] if layer['kind']=='text' and not layer.get('hidden') for item in layer['items'] if valid(item.get('source')) and (item.get('graphic') or {}).get('kind')!='source']
    active=[]
    for index,parent in enumerate(sorted(source_items,key=lambda i:i['start'])):
        active=[(end,slot) for end,slot in active if end>parent['start']];slot=next(n for n in range(len(active)+1) if n not in {s for _,s in active})
        active.append((parent['start']+parent['length'],slot))
        item=source_item(f'__source_note_{index}',parent['source'],parent['start'],parent['length'],max(.12,.95-slot*.07))
        data['layers'].append({'id':f'__source_layer_{index}','kind':'text','name':'Sources','items':[item]})
    if timeline.sources_roll:
        for index,line in enumerate(roll_lines(catalog(data))):
            item=source_item(f'__source_roll_{index}',line,base+index*.8,6,.5)
            item['transform']={'x':.5,'y':.5,'scale':1,'opacity':1,'rotation':0,'keyframes':{'y':[{'t':0,'v':1.1,'ease':'linear'},{'t':6,'v':-.1,'ease':'linear'}]}}
            data['layers'].append({'id':f'__source_roll_layer_{index}','kind':'text','name':'Sources roll','items':[item]})
    return Timeline.model_validate(data)

def source_item(identifier,text,start,length,y=.95):
    return {'id':identifier,'start':start,'length':length,'text':text,'style':'plain','position':'center','size':30,'color':'#ddb168','graphic':{'kind':'source','style':'documentary','from':[.5,y],'to':[.5,y],'width':.92,'height':.075,'line_width':.003}}

def _draw_source(item,fmt,progress):
    image=Image.new('RGBA',(fmt.width,fmt.height));draw=ImageDraw.Draw(image);graphic=item.graphic
    width=round(graphic.width*fmt.width);left=max(2,min(fmt.width-width-2,round(graphic.to[0]*fmt.width-width/2)));height=round(graphic.height*fmt.height)
    top=max(2,min(fmt.height-height-2,round(graphic.to[1]*fmt.height-height/2)));pad=max(6,round(fmt.height*.009))
    size=max(18,least(fmt),round(item.size*fmt.height/1080));lines=wrapped(draw,item.text,size,width-2*pad,height-pad,max(18,least(fmt)))
    heights=[box[3]-box[1] for _,box,_ in lines];gap=max(1,round(fmt.height*.003));total=sum(heights)+gap*(len(lines)-1);y=top+(height-total)/2
    draw.rounded_rectangle((left,top,left+width,top+height),radius=pad,fill=(17,20,25,220))
    for (font,box,shown),h in zip(lines,heights):
        draw.text((left+pad-box[0],y-box[1]),shown,font=font,fill=(221,177,104,255));y+=h+gap
    return image

def render_source(item,fmt,progress):return _smooth(_draw_source,item,fmt,progress)
