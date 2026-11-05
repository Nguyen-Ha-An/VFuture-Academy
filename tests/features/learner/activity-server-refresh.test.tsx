// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ActivityProgressProvider, useActivityProgress } from '@/features/workspace-ui/learner/activity/ActivityProgress';
function Readout() { const frame=useActivityProgress()!;return <><output>{frame.status}:{frame.value.completed}/{frame.value.total}</output><button onClick={()=>frame.report(frame.value,'in_progress')}>Confirmed active attempt</button></>; }
afterEach(cleanup);
it('uses refreshed server progress without resetting locally confirmed active state on unrelated renders',()=>{
 const view=render(<ActivityProgressProvider initial={{completed:0,total:1}} status="not_started"><Readout /></ActivityProgressProvider>);
 fireEvent.click(screen.getByRole('button',{name:'Confirmed active attempt'}));
 expect(screen.getByRole('status')).toHaveTextContent('in_progress:0/1');
 view.rerender(<ActivityProgressProvider initial={{completed:0,total:1}} status="not_started"><Readout /></ActivityProgressProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('in_progress:0/1');
 view.rerender(<ActivityProgressProvider initial={{completed:1,total:1}} status="completed"><Readout /></ActivityProgressProvider>);
 expect(screen.getByRole('status')).toHaveTextContent('completed:1/1');
});
