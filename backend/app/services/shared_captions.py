"""Composite the exact preview/GPU caption pictures in the reference export too."""
from app.services.gpu_documentary import caption

def render_image(item,fmt,target,layer,lit):
    from PIL import Image,ImageDraw
    from app.services.chart_graphics import _smooth,_font,least
    def draw_caption(item,fmt,progress):
        image=Image.new('RGBA',(fmt.width,fmt.height));draw=ImageDraw.Draw(image)
        size=max(18,least(fmt),round(layer.size*fmt.height/1080));font=_font(item.text,size);space=draw.textlength(' ',font=font)
        lines=[];line=[];width=0
        for index,word in enumerate(item.text.split()):
            length=draw.textlength(word,font=font)
            if line and width+space+length>fmt.width*.86:lines.append((line,width));line=[];width=0
            line.append((index,word,length));width+=length+(space if len(line)>1 else 0)
        if line:lines.append((line,width))
        line_h=round(size*1.5);height=len(lines)*line_h;anchor={'top':.13,'center':.5,'bottom':.85}[layer.position]
        baseline=draw.textbbox((0,0),item.text,font=font)[1]
        y=max(8,min(fmt.height-height-8,round(fmt.height*anchor-height/2)));pad=max(6,round(size*.3));widest=max((width for _,width in lines),default=0)
        if layer.style=='band':draw.rounded_rectangle(((fmt.width-widest)/2-pad,y-pad,(fmt.width+widest)/2+pad,y+height+pad),radius=pad,fill=(17,20,25,220))
        for words,width in lines:
            x=(fmt.width-width)/2
            for index,word,length in words:
                colour=layer.highlight if index==lit and layer.highlight else layer.color
                box=draw.textbbox((0,0),word,font=font)
                draw.text((x-box[0],y-baseline),word,font=font,fill=colour,stroke_width=max(1,round(fmt.height*.001)) if layer.style=='outline' else 0,stroke_fill='#15181f')
                x+=length+space
            y+=line_h
        return image
    _smooth(draw_caption,item,fmt,1).save(target)

def add(builder,layer,position,base):
    fps=builder.fmt.fps
    for number,item in enumerate(layer.items):
        name=f'caption-{position}-{number}';plan=caption(item,layer,builder.fmt,builder.folder,name)
        listing=builder.folder/f'{name}.txt';rows=[];shown=plan['shown'];begin=0
        for at in range(1,len(shown)+1):
            if at<len(shown) and shown[at]==shown[begin]:continue
            from pathlib import Path
            rows.extend([f"file '{Path(plan['paths'][shown[begin]]).name}'",f'option framerate {fps}',f'duration {(at-begin)/fps:.6f}']);begin=at
        from pathlib import Path
        rows.extend([f"file '{Path(plan['paths'][shown[-1]]).name}'",f'option framerate {fps}'])
        listing.write_text('\n'.join(rows)+'\n')
        index=builder.add_input('-f','concat','-safe','0','-i',str(listing));output=name.replace('-','_')
        builder.graph.append(f'[{index}:v]fps={fps},format=gbrap,trim=end_frame={len(shown)},setpts=PTS-STARTPTS,settb=AVTB,tpad=start={round(item.start*fps)}:color=black@0[{output}_late]')
        builder.graph.append(f'[{base}][{output}_late]overlay=format=gbrp:eof_action=pass[{output}]');base=output
    return base
