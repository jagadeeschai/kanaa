import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorContext } from '../../src/editor/state/EditorContext';
import { SequenceGraphicFields } from '../../src/editor/inspectors/SequenceGraphicFields';
import { TimelineGraphicFields } from '../../src/editor/inspectors/TimelineGraphicFields';
import { emptyTimeline, type TextItem } from '../../src/timeline/model';

const item: TextItem = { id:'steps',start:1,length:3,text:'Steps',style:'plain',position:'center',color:'#ffffff',size:44,
  graphic:{kind:'step-list',style:'clean',from:[.5,.5],to:[.5,.5],width:.8,height:.8,line_width:.006,steps:['one','two'],points:[{date:'1947',label:'Start'},{date:'2024',label:'Today'}]} };
function Harness({ timeline=false, now=1.5, changed=vi.fn() }) {
  const [text,setText]=useState(item);
  const onChange=(change:Partial<TextItem>)=>{ changed(change); setText((old)=>({...old,...change})); };
  return <EditorContext.Provider value={{timeline:emptyTimeline({width:426,height:240,fps:24}),now,change:vi.fn(),pause:vi.fn(),openGuide:vi.fn(),seek:vi.fn(),select:vi.fn(),selectedId:'steps'}}>
    {timeline ? <TimelineGraphicFields text={text} onChange={onChange}/> : <SequenceGraphicFields text={text} onChange={onChange}/>}
  </EditorContext.Provider>;
}
it('keeps Enter, blank lines and unfinished step text as typed after saving',async()=>{
  render(<Harness/>); const box=screen.getByRole('textbox');
  await userEvent.clear(box); await userEvent.type(box,'1. முதல்{Enter}2. இரண்டாம்{Enter}{Enter}மூ');
  expect((box as HTMLTextAreaElement).value).toBe('1. முதல்\n2. இரண்டாம்\n\nமூ');
});
it('keeps unfinished dates and labels as typed',async()=>{
  render(<Harness timeline/>); const box=screen.getByRole('textbox');
  await userEvent.clear(box); await userEvent.type(box,'1947, முதல்{Enter}2024,{Enter}மா');
  expect((box as HTMLTextAreaElement).value).toBe('1947, முதல்\n2024,\nமா');
});
it('records the playhead relative to the clip and refuses a non-increasing tap',async()=>{
  const changed=vi.fn(); render(<Harness now={1.75} changed={changed}/>);
  await userEvent.click(screen.getByRole('button',{name:/Time each step/}));
  expect(changed).toHaveBeenLastCalledWith({graphic:expect.objectContaining({step_times:[.75]})});
  await userEvent.click(screen.getByRole('button',{name:/Time each step/}));
  expect(screen.getByText('Move the playhead forward inside this clip.')).toBeTruthy();
  expect(changed).toHaveBeenCalledTimes(1);
});
