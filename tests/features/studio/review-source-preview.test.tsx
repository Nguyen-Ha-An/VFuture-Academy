// @vitest-environment jsdom
import {render,screen,cleanup} from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import {afterEach,it,expect,vi} from 'vitest';
import {ReviewSourcePreview} from '@/features/content-review/ReviewSourcePreview';
vi.mock('@/content-engine/render/QuestionRenderer',()=>({QuestionRenderer:({question}:{question:{content:{blocks:{text:string}[]}}})=><div>{question.content.blocks[0].text}</div>}));
vi.mock('@/content-engine/render/BlockList',()=>({BlockList:({blocks}:{blocks:{text:string}[]})=><div>{blocks.map(b=>b.text).join(' ')}</div>}));
vi.mock('@/content-engine/render/blocks',()=>({registerAllBlocks:()=>{}}));
afterEach(cleanup);
it('shows every pinned course item instead of stopping at the first rich block',()=>{
 const source = {manifest:{title:'Khóa AI'},items:{
   intro:{kind:'lesson',id:'intro',title:'Bài mở đầu',blocks:[{type:'paragraph',text:'Nội dung bài đầu'}]},
   exam:{kind:'exam',id:'exam',title:'Thi cuối khóa',sections:[{id:'part',title:'Phần một',questions:[{id:'q1',type:'essay',content:{blocks:[{type:'paragraph',text:'Giải thích mô hình'}]}}]}]}
 }};
 render(<ReviewSourcePreview locale="vi" source={source}/>);
 expect(screen.getByText('Nội dung bài đầu')).toBeInTheDocument();expect(screen.getByText('Giải thích mô hình')).toBeInTheDocument();
});
