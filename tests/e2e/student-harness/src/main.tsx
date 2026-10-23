import { benchTheme } from './bench-env';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { StatusNotice } from '@/components/ui/page';
import { AppShell } from '@/components/AppShell';
import { FocusOutline } from '@/features/learner/ui/FocusOutline';
import { registerAllBlocks, registerContentBlocks } from '@/content-engine/render/blocks';
import { registerChoiceQuestions } from '@/content-engine/render/questions';
import { QuizRenderer } from '@/content-engine/render/QuizRenderer';
import type { LessonRuntime } from '@/content-engine/render/runtime';
import type { QuizBlock } from '@/content-engine/schema/types';
import Home from '@/app/app/page';
import Catalog from '@/app/app/courses/page';
import Course from '@/app/app/courses/[courseId]/page';
import Explore from '@/app/app/explore/page';
import Profile from '@/app/app/profile/page';
import Resources from '@/app/app/resources/page';
import ResourceDetail from '@/app/app/resources/[id]/page';
import Opportunities from '@/app/app/opportunities/page';
import OpportunityDetail from '@/app/app/opportunities/[id]/page';
import Projects from '@/app/app/projects/page';
import ProjectDetail from '@/app/app/projects/[id]/page';
import NewProject from '@/app/app/projects/new/page';
import Leaderboard from '@/app/app/leaderboard/page';
import en from '../../../../src/messages/en.json';
import vi from '../../../../src/messages/vi.json';
import '@/app/globals.css';
import { withBenchMessages } from '@/messages/bench';
import { usePathname, useSearchParams } from './next-navigation';
import { resolveAsync } from './resolve-async';
import { NotebookWorkspaceFixture } from './notebook-workspace-fixture';
import { LessonBlocksPage } from './lesson-blocks-fixture';
import { FocusBar } from '@/features/workspace-ui/learner/activity/FocusBar';

const query = new URLSearchParams(location.search);
const locale = query.get('lang') === 'en' ? 'en' : 'vi';
document.documentElement.lang = locale;
document.documentElement.classList.toggle('dark', query.get('theme') === 'dark');
const state = new Map<string, unknown>();
let checks = 0;
const unavailable = async (): Promise<never> => { throw new Error('Not part of fixture'); };
const runtime: LessonRuntime = {
 mode:'learner',locale,getBlockState:<T,>(id:string)=>state.get(id) as T | undefined,setBlockState:(id,value)=>{state.set(id,value);},
 checkQuestion:async (_quiz,questionId,answer)=>{ checks++; (window as unknown as {fixtureChecks:unknown}).fixtureChecks={checks,answer}; if(checks===1) throw new Error('Fixture check unavailable'); return {questionId,points:1,maxPoints:1,status:'correct',revealed:{correctAnswers:{q1:'yes'}}}; },
 submitQuiz:unavailable,getAssignmentSession:()=>undefined,refreshAssignmentSession:unavailable,submitAssignment:unavailable,uploadAssignmentFile:unavailable,uploadFile:unavailable,resolveMedia:()=>'',hrefFor:()=>'/app',markViewed(){},onActivityComplete(){}
};
registerChoiceQuestions();
registerContentBlocks();
registerAllBlocks();
const rich = (text: string) => ({blocks:[{type:'paragraph',content:[{text}]}]});
const quiz = {id:'quiz-fixture',type:'quiz',title:'Fixture quiz',settings:{mode:'practice',feedback:'per_question'},questions:[{id:'q1',type:'single_choice',content:rich('Choose the first option'),points:1,options:[{id:'yes',content:rich('First option')},{id:'no',content:rich('Second option')}]}]} as unknown as QuizBlock;
// The real focus bar (nav, no brand link) carries the outline trigger, the only aria-haspopup="dialog".
function FocusPage() { return <div className="vf-activity" data-width="reading"><FocusBar course={{title:'AI basics',href:'/app/courses/ai-basics'}} position={{current:1,total:2}} outline={<FocusOutline courseId="ai-basics" itemId="lesson-1" courseTitle="AI basics" modules={[{id:'m1',title:'Start here',items:[{id:'lesson-1',title:'First lesson',status:'completed'},{id:'lesson-2',title:'A longer next lesson title to check wrapping',status:'not_started'}]}]} />} /><div className="vf-activity-body"><h1 className="vf-activity-title">Fixture lesson</h1><div><QuizRenderer block={quiz} runtime={runtime}/></div></div></div>; }
class HarnessBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
 state = { error: null as Error | null };
 static getDerivedStateFromError(error: Error) { return { error }; }
 render() { return this.state.error ? <pre role="alert">{String(this.state.error.stack)}</pre> : this.props.children; }
}
function Harness() {
 const pathname=usePathname(); const search=useSearchParams().toString(); const [content,setContent]=useState<React.ReactNode>(null);
 useEffect(()=>{ let active=true; setContent(null); const searchParams=Promise.resolve(Object.fromEntries(new URLSearchParams(location.search)));
 const render = pathname==='/app/courses/ai-basics/items/notebook-lab/notebook' ? Promise.resolve(<NotebookWorkspaceFixture />) : pathname==='/app/courses/ai-basics/items/lesson-blocks' ? Promise.resolve(<LessonBlocksPage locale={locale} />) : pathname.includes('/items/') ? Promise.resolve(<FocusPage />) : pathname==='/app/courses/ai-basics' ? Course({params:Promise.resolve({courseId:'ai-basics'})}) : pathname==='/app/courses' ? Catalog({searchParams}) : pathname==='/app/explore' ? Explore() : pathname==='/app/profile' ? Profile() : pathname==='/app/resources' ? Resources({searchParams}) : pathname==='/app/resources/fixture-resource' ? ResourceDetail({params:Promise.resolve({id:'fixture-resource'}), searchParams}) : pathname==='/app/opportunities' ? Opportunities({searchParams}) : pathname==='/app/opportunities/fixture-opportunity' ? OpportunityDetail({params:Promise.resolve({id:'fixture-opportunity'}), searchParams}) : pathname==='/app/projects' ? Projects({searchParams}) : pathname==='/app/projects/new' ? NewProject() : pathname==='/app/projects/fixture-project' ? ProjectDetail({params:Promise.resolve({id:'fixture-project'}), searchParams}) : pathname==='/app/leaderboard' ? Leaderboard({searchParams}) : pathname==='/app/notices' ? Promise.resolve(<><h1>Status notices</h1><div className="mt-8 space-y-4">{(['neutral','success','warning','error'] as const).map(tone=><StatusNotice key={tone} tone={tone}>{tone}: Your learning progress has been updated.</StatusNotice>)}</div></>) : pathname==='/app' ? Home() : Promise.resolve(<h1>Unavailable fixture route</h1>);
 render.then(value=>resolveAsync(value)).then(value=>{if(active)setContent(value);}).catch(error=>{if(active)setContent(<pre role="alert">{String(error.stack)}</pre>);}); return ()=>{active=false;};
 },[pathname,search]);
 return <NextIntlClientProvider locale={locale} messages={withBenchMessages(locale==='en'?en:vi, locale)} timeZone="UTC"><AppShell theme={benchTheme} userName="A very long learner name used to verify account menu geometry and truncation behavior" initials="TB" handle="fixture-learner" studioDestination="/studio" gradingDestination="/grading" adminDestination="/admin"><HarnessBoundary key={pathname + search}>{content}</HarnessBoundary></AppShell></NextIntlClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
