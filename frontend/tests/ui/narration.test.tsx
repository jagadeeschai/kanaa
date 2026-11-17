import { expect,it,vi } from 'vitest';
import { render,screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NarratePanel from '../../src/editor/NarratePanel';
import { EditorContext } from '../../src/editor/state/EditorContext';
import { emptyTimeline } from '../../src/timeline/model';

it('requires a cost estimate, keeps the script as typed, and places the returned timeline',async()=>{
  const base=emptyTimeline({width:1920,height:1080,fps:30}),changed=vi.fn();
  const fetcher=vi.fn(async(path:string,options?:RequestInit)=>{
    const body=options?.body ? JSON.parse(options.body as string):{};
    const data=path.endsWith('/voices') ? [{name:'ta-IN-Chirp3-HD-New',price_per_million:30}] : path.endsWith('/estimate') ? {quote:'test',usd:.002,preview_usd:.001,sentences:2,cached_sentences:0,sentence_captions:true,pricing_url:'https://cloud.google.com/text-to-speech/pricing'} : {timeline:base,lines:[{asset_id:'a'.repeat(32)}]};
    return {ok:true,json:async()=>data};
  });vi.stubGlobal('fetch',fetcher);
  render(<EditorContext.Provider value={{timeline:base,now:2,selectedId:null,select:vi.fn(),change:changed,pause:vi.fn(),seek:vi.fn(),openGuide:vi.fn(),addMedia:vi.fn(),drawBox:vi.fn()}}><NarratePanel/></EditorContext.Provider>);
  expect((screen.getByRole('button',{name:'Add to timeline'}) as HTMLButtonElement).disabled).toBe(true);
  await userEvent.type(screen.getByRole('textbox'),'முதல் வரி.{Enter}இரண்டாம்');
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('முதல் வரி.\nஇரண்டாம்');
  await userEvent.click(screen.getByRole('button',{name:'Load Google voices'}));
  await userEvent.click(screen.getByRole('button',{name:'Estimate voice cost'}));
  expect(screen.getByText(/US\$0.00200/)).toBeTruthy();
  await userEvent.click(screen.getByRole('button',{name:'Add to timeline'}));
  expect(changed).toHaveBeenCalledWith(base);
  const call=fetcher.mock.calls.find(([url])=>url.endsWith('/generate'))!;
  expect(JSON.parse(call[1]!.body as string)).toMatchObject({quote:'test',max_cost:.002,start:2});
  vi.unstubAllGlobals();
});
