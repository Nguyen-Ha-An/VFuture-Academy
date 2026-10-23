import {useEffect,useState} from 'react';
import {LearningReports} from '../../../../src/features/reporting/ui/LearningReports';
const rate={percent:80,sampleSize:5};
const report={period:{from:'2026-08-09',to:'2026-09-07',timezone:'Asia/Ho_Chi_Minh'},filters:{branchId:'school',courseId:null,publication:'released'},visibility:{unknownHistoricalBranch:false},overview:{activeUsers:24,newEnrollments:12,cohort:{enrollments:12,completedByPeriodEnd:8,completionRate:66.67},attempts:{quiz:32,exam:18,assignment:9},averages:{quiz:rate,exam:rate,assignment:rate},passRates:{quiz:rate,exam:rate,assignment:rate}},courses:[{courseId:'ai',title:'Nền tảng trí tuệ nhân tạo',newEnrollments:12,completedByPeriodEnd:8,completionRate:66.67,attempts:{quiz:32,exam:18,assignment:9},averages:{quiz:rate,exam:rate,assignment:rate},passRates:{quiz:rate,exam:rate,assignment:rate}}],questions:[{courseId:'ai',courseVersionId:'version-1',itemId:'exam-1',questionId:'s1/q1',questionVersionId:'qv-1',prompt:'Explain the evidence choice.',itemTitle:'Midterm exam',zeroPointAnswers:3,gradedAnswers:10,zeroPointRate:30,sourceHref:'/studio/grading?courseId=ai'}],grading:{asOf:'2026-09-07T03:00:00Z',label:'current',assignments:{pending:2,unpublished:1},exams:{pendingManualAttempts:3,pendingManualQuestions:5,unpublished:2}}};

/** Browser-harness-only fixture. `?canGrade=1` renders the grader-only links. */
export function ReportFixture(){
  const [ready,setReady]=useState(false);
  useEffect(()=>{const original=window.fetch;window.fetch=async()=>new Response(JSON.stringify({data:report}),{headers:{'content-type':'application/json'}});setReady(true);return()=>{window.fetch=original}},[]);
  const canGrade=new URLSearchParams(location.search).get('canGrade')==='1';
  return ready?<LearningReports actorId="reporter" scope={{kind:'branch',branchId:'school'}} branches={[{id:'school',name:'Trường VFuture'}]} canGrade={canGrade}/>:null;
}
