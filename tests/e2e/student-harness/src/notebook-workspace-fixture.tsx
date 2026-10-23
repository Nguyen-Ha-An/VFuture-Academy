import { FocusOutline } from '@/features/learner/ui/FocusOutline';
import { NotebookWorkspace } from '@/features/notebooks/ui/NotebookWorkspace';
import { ActivityFrame } from '@/features/workspace-ui/learner/activity/ActivityFrame';

const modules = [{ id: 'm1', title: 'Start here', items: [
  { id: 'lesson-1', title: 'First lesson', status: 'completed' },
  { id: 'notebook-lab', title: 'Notebook lab', status: 'in_progress' },
] }];

// Mirrors the learner notebook route: the activity frame owns the h1 (the item title) and the way back.
export function NotebookWorkspaceFixture() {
  const progress = { completed: 1, total: 2 };
  return <ActivityFrame
    kind="notebook"
    width="frame"
    course={{ title: 'AI basics', href: '/app/courses/ai-basics' }}
    progress={progress}
    position={{ current: 2, total: 2 }}
    outline={<FocusOutline courseId="ai-basics" itemId="notebook-lab" modules={modules} courseTitle="AI basics" progress={progress} />}
    head={{ kicker: <><span>Assignment</span><span aria-hidden="true"> · </span><span>Notebook</span></>, title: 'Notebook lab', meta: ['M01 · 02 / 02'], status: 'in_progress' }}
    pager={{ label: 'Previous and next', previous: { href: '/app/courses/ai-basics/items/notebook-lab', title: 'Notebook lab', kicker: 'Back to assignment' } }}
  >
    <NotebookWorkspace
      locator={{ courseId: 'ai-basics', itemId: 'notebook-lab', blockId: null }}
      runtimeUrl={`${location.origin}/notebook-frame.html`}
    />
  </ActivityFrame>;
}
