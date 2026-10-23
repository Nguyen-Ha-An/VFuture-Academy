// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, expect, it, vi } from 'vitest';
import viMessages from '@/messages/vi.json';
import { staffUiTestMessages } from '@/messages/staff-ui';
import { LearningReports } from '@/features/reporting/ui/LearningReports';
import { ReportPanels } from '@/features/reporting/ui/ReportPanels';
import { reportCopy } from '@/features/reporting/ui/messages';
import type { StudioLearningReport } from '@/features/reporting/contracts';
const messages = staffUiTestMessages(viMessages, 'vi');
const inVietnamese = (ui: ReactElement) => render(<NextIntlClientProvider locale="vi" messages={messages} timeZone="Asia/Ho_Chi_Minh">{ui}</NextIntlClientProvider>);
const response = {
 period:{from:'2026-08-09',to:'2026-09-07',timezone:'Asia/Ho_Chi_Minh'},filters:{branchId:'school',courseId:null},visibility:{unknownHistoricalBranch:false},
 overview:{activeUsers:4,newEnrollments:2,cohort:{enrollments:2,completedByPeriodEnd:1,completionRate:50},attempts:{quiz:3,exam:2,assignment:1},averages:{quiz:{percent:80,sampleSize:3},exam:{percent:null,sampleSize:0},assignment:{percent:90,sampleSize:1}},passRates:{quiz:{percent:100,sampleSize:3},exam:{percent:null,sampleSize:0},assignment:{percent:100,sampleSize:1}}},
 courses:[],questions:[],grading:{asOf:'2026-09-07T03:00:00Z',label:'current',assignments:{pending:2,unpublished:1},exams:{pendingManualAttempts:3,pendingManualQuestions:5,unpublished:2}}
};
afterEach(()=>{cleanup();vi.unstubAllGlobals()});
it('renders overview metrics as StatCards with hints inside valid definition descriptions',()=>{
 const rendered=inVietnamese(<ReportPanels data={response as unknown as StudioLearningReport} tab={0} copy={reportCopy.vi} locale="vi" canGrade={false}/>);
 const cards=rendered.container.querySelectorAll('dl[data-slot="stat-grid"] > [data-slot="stat-card"]');
 expect(cards).toHaveLength(3);
 expect(rendered.container.querySelector('dl > div > p')).not.toBeInTheDocument();
 for(const card of cards){expect(card.querySelector(':scope > dt')).toBeInTheDocument();expect(card.querySelectorAll(':scope > dd')).toHaveLength(1);}
 expect(cards[2].querySelector(':scope > dd')).toHaveTextContent('50%');
 expect(cards[2].querySelector(':scope > dd')).toHaveTextContent(reportCopy.vi.cohortHint);
 // Snapshot numbers of one period: no delta without a same-definition previous value.
 expect(rendered.container.querySelector('[data-slot="stat-delta"]')).not.toBeInTheDocument();
 // Attempts by type sit in a chart card whose accessible table carries the numbers.
 expect(screen.getByRole('heading',{name:'Lượt nộp theo loại bài'})).toBeInTheDocument();
 expect(screen.getByRole('table',{name:'Lượt nộp theo loại bài'})).toHaveTextContent('Quiz3');
});
it('shows the grading workload as StatCards with the backlog heading and queue link',()=>{
 inVietnamese(<ReportPanels data={response as unknown as StudioLearningReport} tab={3} copy={reportCopy.vi} locale="vi" canGrade/>);
 expect(screen.getByRole('heading',{name:/Tồn đọng hiện tại/})).toBeInTheDocument();
 expect(screen.getByText('Lượt thi chờ chấm tay').closest('[data-slot="stat-card"]')).toHaveTextContent('3');
 expect(screen.getByRole('link',{name:'Mở chấm bài'})).toHaveAttribute('href','/grading/queue?branchId=school&back=%2Fgrading%2Freports');
});
it('loads scoped reports and distinguishes missing grades from zero scores', async()=>{
 const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({data:response})));vi.stubGlobal('fetch',fetcher);
 inVietnamese(<LearningReports canGrade actorId="teacher" scope={{kind:'branch',branchId:'school'}} branches={[{id:'school',name:'Trường A'}]} />);
 await screen.findByText('50%');
 expect(screen.getByText('Báo cáo vận hành')).toBeInTheDocument();
 expect(fetcher.mock.calls[0][0]).toContain('branchId=school');
 expect(fetcher.mock.calls[0][0]).toContain('actorId=teacher');
 expect(screen.getAllByText('Chưa có dữ liệu').length).toBeGreaterThan(0);
 fireEvent.click(screen.getByRole('tab',{name:'Khối lượng chấm'}));
 expect(screen.getByText(/Tồn đọng hiện tại/)).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Mở chấm bài'})).toHaveAttribute('href',expect.stringContaining('/grading/queue'));
 expect(screen.getByRole('link',{name:'Mở chấm bài'})).toHaveAttribute('href',expect.stringContaining('back=%2Fgrading%2Freports'));
});
it('shows errors with retry instead of fabricating empty results',async()=>{
 const fetcher=vi.fn().mockRejectedValue(new Error('offline'));vi.stubGlobal('fetch',fetcher);
 inVietnamese(<LearningReports canGrade actorId="teacher" scope={{kind:'branch',branchId:'school'}} branches={[{id:'school',name:'Trường A'}]} />);
 await screen.findByRole('alert');
 expect(screen.getByRole('button',{name:'Thử lại'})).toBeInTheDocument();
 expect(screen.queryByText('0%')).not.toBeInTheDocument();
 fetcher.mockResolvedValue(new Response(JSON.stringify({data:response})));
 fireEvent.click(screen.getByRole('button',{name:'Thử lại'}));
 await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});
