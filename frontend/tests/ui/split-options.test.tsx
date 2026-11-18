import {it,expect,vi} from 'vitest';import {render,screen,within} from '@testing-library/react';import userEvent from '@testing-library/user-event';
import {SplitOptions} from '../../src/editor/SplitOptions';
it('highlights every chosen option with on and updates each independent setting',async()=>{
 const change=vi.fn();const {rerender}=render(<SplitOptions value={{kind:'split',duration:.6,split_panels:3,split_direction:'diagonal',split_style:'shadow'}} onChange={change}/>);
 for(const [group,label] of [['Panels','3'],['Direction','Diagonal'],['Style','Soft edge shadow']])expect(within(screen.getByRole('group',{name:group})).getByRole('button',{name:label}).classList.contains('on')).toBe(true);
 await userEvent.click(screen.getByRole('button',{name:'4'}));expect(change.mock.lastCall?.[0].split_panels).toBe(4);
 rerender(<SplitOptions value={{kind:'split',duration:.6}} onChange={change}/>);expect(screen.getByRole('button',{name:'2'}).classList.contains('on')).toBe(true);expect(screen.getByRole('button',{name:'Clean'}).classList.contains('on')).toBe(true);
});
