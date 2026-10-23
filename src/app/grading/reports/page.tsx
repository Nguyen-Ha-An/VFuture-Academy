import { forbidden } from 'next/navigation';
import { gradingPageContext } from '@/features/workspace/context';
import { LearningReports } from '@/features/reporting/ui/LearningReports';
import { can } from '@/lib/permissions';

export default function LearningReportsPage(): Promise<React.JSX.Element>;
export default function LearningReportsPage(props: {searchParams?:Promise<Record<string,string|string[]|undefined>>}): Promise<React.JSX.Element>;
export default async function LearningReportsPage({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}={}) {
  const context = await gradingPageContext();
  const permission=context.scope.kind==='central'?'report.global.read':'report.branch.read';
  const legacy=context.scope.kind==='central'?'analytics.global.read':'analytics.branch.read';
  if(!can(context.actor,permission,context.scope)&&!can(context.actor,legacy,context.scope))forbidden();
  const params=await searchParams??{};
  const initialFilters=Object.fromEntries(['from','to','branchId','courseId','publication'].flatMap(key=>typeof params[key]==='string'?[[key,params[key]]]:[]));
  return <LearningReports canGrade={can(context.actor,'submission.grade',context.scope)} initialFilters={initialFilters} actorId={context.actor.userId} scope={context.scope} branches={context.branches}/>;
}
