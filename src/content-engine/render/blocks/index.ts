import { registerBlock } from '../registry';
import { Paragraph } from './Paragraph'; import { Heading } from './Heading'; import { List } from './List'; import { Quote } from './Quote'; import { Image } from './Image';
import { Video } from './Video'; import { Audio } from './Audio'; import { Table } from './Table'; import { Code } from './Code'; import { Divider } from './Divider';
import { Embed } from './Embed'; import { Pdf } from './Pdf'; import { Callout } from './Callout';
import { Reflection } from './Reflection'; import { Flashcards } from './Flashcards'; import { Accordion } from './Accordion'; import { Tabs } from './Tabs'; import { Reveal } from './Reveal'; import { Stepper } from './Stepper';
import { ResourceLink } from './ResourceLink'; import { OpportunityLink } from './OpportunityLink'; import { NextStep } from './NextStep';
import { QuizBlockRenderer } from '../QuizRenderer';
import { AssignmentBlockRenderer } from '../AssignmentRenderer';

let done = false;
export function registerContentBlocks() {
  if (done) return; done = true;
  registerBlock('paragraph', Paragraph); registerBlock('heading', Heading); registerBlock('list', List); registerBlock('quote', Quote); registerBlock('image', Image);
  registerBlock('video', Video); registerBlock('audio', Audio); registerBlock('table', Table); registerBlock('code', Code); registerBlock('divider', Divider);
  registerBlock('embed', Embed); registerBlock('pdf', Pdf); registerBlock('callout', Callout);
}

let activitiesDone = false;
export function registerActivityBlocks() {
  if (activitiesDone) return; activitiesDone = true;
  registerBlock('reflection', Reflection); registerBlock('flashcards', Flashcards); registerBlock('accordion', Accordion); registerBlock('tabs', Tabs); registerBlock('reveal', Reveal); registerBlock('stepper', Stepper);
  registerBlock('resource_link', ResourceLink); registerBlock('opportunity_link', OpportunityLink); registerBlock('next_step', NextStep);
}

let allDone = false;
export function registerAllBlocks() {
  if (allDone) return; allDone = true;
  registerContentBlocks(); registerActivityBlocks();
  registerBlock('quiz', QuizBlockRenderer); registerBlock('assignment', AssignmentBlockRenderer);
}
