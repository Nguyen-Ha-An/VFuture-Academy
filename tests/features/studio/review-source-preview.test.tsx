// @vitest-environment jsdom
import {render,screen,cleanup,within} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import userEvent from '@testing-library/user-event';
import {afterEach,it,expect,vi} from 'vitest';
import {ReviewSourcePreview} from '@/features/content-review/ReviewSourcePreview';
vi.mock('@/content-engine/render/QuestionRenderer',()=>({QuestionRenderer:({question}:{question:{content:{blocks:{text:string}[]}}})=><div>{question.content.blocks[0].text}</div>}));
vi.mock('@/content-engine/render/BlockList',()=>({BlockList:({blocks}:{blocks:{text:string}[]})=><div>{blocks.map(b=>b.text).join(' ')}</div>}));
vi.mock('@/content-engine/render/blocks',()=>({registerAllBlocks:()=>{}}));
afterEach(cleanup);
it('renders overview or one selected item in manifest order, excluding unlisted objects',async()=>{
 const source = {manifest:{title:'Khóa AI',modules:[{id:'m1',title:'Học phần',items:[{id:'intro',title:'Bài mở đầu'},{id:'exam',title:'Thi cuối khóa'}]}]},items:{
   orphan:{kind:'lesson',title:'Unlisted',blocks:[{text:'Never render this'}]},
   exam:{kind:'exam',id:'exam',title:'Thi cuối khóa',sections:[{id:'part',title:'Phần một',questions:[{id:'q1',type:'essay',content:{blocks:[{type:'paragraph',text:'Giải thích mô hình'}]}}]}]},
   intro:{kind:'lesson',id:'intro',title:'Bài mở đầu',blocks:[{type:'paragraph',text:'Nội dung bài đầu'}]}
 }};
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 render(<ReviewSourcePreview locale="vi" source={source}/>);
 expect(screen.getByRole('heading',{name:'Khóa AI'})).toBeInTheDocument();
 const nav=screen.getByRole('navigation',{name:'Nội dung bản duyệt'});
 expect(within(nav).getAllByRole('button').map(node=>node.textContent)).toEqual(['Tổng quan khóa học','Bài mở đầu','Thi cuối khóa']);
 expect(screen.queryByText('Nội dung bài đầu')).toBeNull();
 await userEvent.click(within(nav).getByRole('button',{name:'Bài mở đầu'}));
 expect(screen.getByText('Nội dung bài đầu')).toBeInTheDocument();
 expect(screen.queryByText('Giải thích mô hình')).toBeNull();
 await userEvent.click(within(nav).getByRole('button',{name:'Thi cuối khóa'}));
 expect(screen.getByText('Giải thích mô hình')).toBeInTheDocument();
 expect(screen.queryByText('Nội dung bài đầu')).toBeNull();
 expect(screen.queryByText('Never render this')).toBeNull();
 expect(fetch).not.toHaveBeenCalled();vi.unstubAllGlobals();
});
