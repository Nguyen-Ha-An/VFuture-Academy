import { registerQuestion } from '../registry';
import { playerKey } from '../../manifest/players';
import { SingleChoice } from './SingleChoice'; import { MultipleChoice } from './MultipleChoice'; import { TrueFalse } from './TrueFalse';
import { FillBlank } from './FillBlank'; import { ShortAnswer } from './ShortAnswer'; import { Numeric } from './Numeric'; import { Essay } from './Essay';
import { Matching } from './Matching'; import { Ordering } from './Ordering'; import { Classification } from './Classification';
import { UploadAnswer } from './UploadAnswer'; import { CodeAnswer } from './CodeAnswer'; import { QuestionGroup } from './QuestionGroup';
let choiceDone = false;
export function registerChoiceQuestions() {
  if (choiceDone) return; choiceDone = true;
  for (const i of ['radio', 'button', 'dropdown', 'image']) registerQuestion(playerKey('single_choice', i), SingleChoice);
  for (const i of ['checkbox', 'button', 'image']) registerQuestion(playerKey('multiple_choice', i), MultipleChoice);
  for (const i of ['boolean', 'yes_no']) registerQuestion(playerKey('true_false', i), TrueFalse);
}

let textDone = false;
export function registerTextQuestions() {
  if (textDone) return; textDone = true;
  for (const i of ['text', 'dropdown', 'word_bank']) registerQuestion(playerKey('fill_blank', i), FillBlank);
  registerQuestion(playerKey('short_answer', 'text'), ShortAnswer);
  registerQuestion(playerKey('numeric', 'numeric'), Numeric);
  registerQuestion(playerKey('essay', 'long_text'), Essay);
}

let structureDone = false;
export function registerStructureQuestions() {
  if (structureDone) return; structureDone = true;
  for (const i of ['columns', 'lines']) registerQuestion(playerKey('matching', i), Matching);
  for (const i of ['list', 'timeline']) registerQuestion(playerKey('ordering', i), Ordering);
  registerQuestion(playerKey('classification', 'buckets'), Classification);
}

let manualDone = false;
export function registerManualQuestions() {
  if (manualDone) return; manualDone = true;
  registerQuestion(playerKey('upload_answer', 'upload'), UploadAnswer);
  registerQuestion(playerKey('code_answer', 'editor'), CodeAnswer);
  registerQuestion(playerKey('question_group', 'list'), QuestionGroup);
}

export function registerAllQuestions() { registerChoiceQuestions(); registerTextQuestions(); registerStructureQuestions(); registerManualQuestions(); }
