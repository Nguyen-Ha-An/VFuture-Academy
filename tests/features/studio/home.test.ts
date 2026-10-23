import {beforeEach,describe,it,expect,vi} from 'vitest';
import {createElement,type ComponentProps} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NextIntlClientProvider} from 'next-intl';
import viMessages from '@/messages/vi.json';
import {staffUiTestMessages} from '@/messages/staff-ui';
const mocks=vi.hoisted(()=>({context:vi.fn(),listContent:vi.fn(),listReviews:vi.fn(),database:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next-intl/server',()=>({getLocale:async()=> 'vi'}));
vi.mock('@/features/workspace/context',()=>({studioPageContext:mocks.context}));
vi.mock('@/lib/supabase/server',()=>({supabaseService:mocks.database}));
vi.mock('@/features/admin/content-review',()=>({createContentReviewService:()=>({listContent:mocks.listContent,listReviews:mocks.listReviews})}));
import StudioPage from '@/app/studio/page';
// The view renders the staff kit, which reads staffUi strings from the intl provider.
const intl={locale:'vi',messages:staffUiTestMessages(viMessages,'vi'),timeZone:'Asia/Ho_Chi_Minh'} as unknown as ComponentProps<typeof NextIntlClientProvider>; // children arrive as createElement's third argument
const render=async()=>renderToStaticMarkup(createElement(NextIntlClientProvider,intl,await StudioPage()));
beforeEach(()=>{vi.clearAllMocks();mocks.listContent.mockResolvedValue([]);mocks.listReviews.mockResolvedValue([]);});
describe('Studio overview',()=>{
 it('never offers a grading or reporting destination from the content workspace',async()=>{
  mocks.context.mockResolvedValue({permissions:['course.read','bank.edit']});
  const html=await render();
  expect(html).toContain('/studio/courses');expect(html).toContain('/studio/bank');
  expect(html).not.toContain('/grading');expect(html).not.toContain('/admin');
 });
 it('offers no destination and reads nothing for a grading-only operator',async()=>{
  mocks.context.mockResolvedValue({permissions:['submission.grade']});
  const html=await render();
  expect(html).not.toContain('/studio/courses');expect(html).not.toContain('/grading');
  expect(mocks.database).not.toHaveBeenCalled();
 });
 it('counts only pending reviews and shows localized recent content',async()=>{
  mocks.context.mockResolvedValue({permissions:['content.review','content.read'],actor:{userId:'reviewer'},scope:{kind:'central'}});
  mocks.listReviews.mockResolvedValue([{status:'pending'},{status:'approved'},{status:'pending'}]);
  mocks.listContent.mockResolvedValue([{content_type:'resource',content_id:'guide',title:{vi:'Hướng dẫn'},studio_href:'/studio/resources/guide'}]);
  const html=await render();expect(html).toContain('Đang chờ duyệt');
  // KPI semantics moved from <p> to a <dl>: the "Đang chờ duyệt" term's <dd> holds the value 2.
  expect(html).toMatch(/<dt[^>]*>(?:(?!<\/dt>).)*Đang chờ duyệt(?:(?!<\/dt>).)*<\/dt><dd[^>]*><span[^>]*>2<\/span>/);
  expect(html).toContain('Hướng dẫn');expect(html).toContain('/studio/resources/guide');
 });
 it('preserves workspace authentication failures',async()=>{
  mocks.context.mockRejectedValue(new Error('redirect:/login'));await expect(StudioPage()).rejects.toThrow('redirect:/login');expect(mocks.database).not.toHaveBeenCalled();
 });
});
