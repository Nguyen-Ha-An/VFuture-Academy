import type { L10nString, MediaRef, Locale } from './common';
import type { Run } from './inline';
import type { Question, QuizQuestionEntry } from './questions';
import type { Rubric } from './questions/base';
import type { NotebookAssignment } from './notebook';

export type Align = 'left' | 'center' | 'right' | 'justify';
export type CalloutVariant = 'info' | 'tip' | 'warning' | 'danger' | 'note';

export interface ParagraphBlock { id?: string; type: 'paragraph'; content: Run[]; align?: Align }
export interface HeadingBlock { id?: string; type: 'heading'; level: 1 | 2 | 3 | 4; content: Run[]; align?: Align }
export interface ListItem { content: Run[]; items?: ListItem[] }
export interface ListBlock { id?: string; type: 'list'; ordered: boolean; items: ListItem[] }
export interface QuoteBlock { id?: string; type: 'quote'; content: Run[]; author?: L10nString }
export interface ImageBlock { id?: string; type: 'image'; src: MediaRef; alt: L10nString; caption?: L10nString; width?: 'sm' | 'md' | 'full' }
export type VideoBlock =
  | { id?: string; type: 'video'; src: MediaRef; poster?: MediaRef; caption?: L10nString; provider?: undefined; url?: undefined }
  | { id?: string; type: 'video'; provider: 'youtube' | 'vimeo'; url: string; caption?: L10nString; src?: undefined; poster?: undefined };
export interface AudioBlock { id?: string; type: 'audio'; src: MediaRef; label?: L10nString }
export interface TableCell { content: Run[]; align?: Align }
export interface TableBlock { id?: string; type: 'table'; headers?: TableCell[]; rows: TableCell[][]; caption?: L10nString }
export interface CodeBlock { id?: string; type: 'code'; language: string; code: string; filename?: string; highlightLines?: number[]; showLineNumbers?: boolean }
export interface DividerBlock { id?: string; type: 'divider' }
export interface EmbedBlock { id?: string; type: 'embed'; url: string; title: L10nString; aspectRatio?: '16:9' | '4:3' | '1:1' }
export interface PdfBlock { id?: string; type: 'pdf'; src: MediaRef; title: L10nString; height?: number }
export interface MathBlock { id?: string; type: 'math'; latex: string }
export interface DiagramBlock { id?: string; type: 'diagram'; src: MediaRef; alt: L10nString }
export interface CalloutBlock<B> { id?: string; type: 'callout'; variant: CalloutVariant; title?: L10nString; blocks: B[] }

export type ContentBlock =
  | ParagraphBlock | HeadingBlock | ListBlock | QuoteBlock | ImageBlock | VideoBlock | AudioBlock | TableBlock
  | CodeBlock | DividerBlock | EmbedBlock | PdfBlock | MathBlock | DiagramBlock | CalloutBlock<ContentBlock>;

export interface RichContent { blocks: ContentBlock[] }
export type L10nRichContent = RichContent | Partial<Record<Locale, RichContent>>;

// --- activity blocks ---

export interface QuizSettings { mode?: 'practice' | 'graded'; attemptsAllowed?: number; feedback?: 'per_question' | 'after_submit' | 'none'; showExplanations?: boolean; shuffleQuestions?: boolean; passPercent?: number; required?: boolean }
export interface QuizBlock { id: string; type: 'quiz'; title?: L10nString; intro?: L10nRichContent; questions: QuizQuestionEntry[]; settings?: QuizSettings }
export interface SubmissionSpec { accepts: ('text' | 'link' | 'file' | 'code')[]; maxFiles?: number; maxFileSizeMB?: number; allowedMimeTypes?: string[]; linkHosts?: string[]; codeLanguage?: string }
export interface AssignmentBody { id: string; title: L10nString; instructions: L10nRichContent; submission: SubmissionSpec; rubric?: Rubric; passPoints?: number; skills?: string[]; resubmission?: 'until_approved' | 'once' | 'never'; required?: boolean; notebook?: NotebookAssignment }
export interface AssignmentBlock extends AssignmentBody { type: 'assignment' }
export interface ReflectionBlock { id: string; type: 'reflection'; prompt: L10nRichContent; required?: boolean; minChars?: number; maxChars?: number }
export interface FlashcardsBlock { id: string; type: 'flashcards'; cards: { id: string; front: L10nRichContent; back: L10nRichContent }[]; shuffle?: boolean }
export interface AccordionBlock<B> { id: string; type: 'accordion'; items: { id: string; title: L10nString; blocks: B[] }[]; allowMultipleOpen?: boolean }
export interface TabsBlock<B> { id: string; type: 'tabs'; items: { id: string; title: L10nString; blocks: B[] }[] }
export interface RevealBlock<B> { id: string; type: 'reveal'; label: L10nString; blocks: B[] }
export interface StepperBlock<B> { id: string; type: 'stepper'; steps: { id: string; title: L10nString; blocks: B[] }[]; linear?: boolean }
export interface ResourceLinkBlock { id: string; type: 'resource_link'; resourceId: string; label?: L10nString; required?: boolean }
export interface OpportunityLinkBlock { id: string; type: 'opportunity_link'; opportunityId: string; relationship: 'recommended_next_step' | 'related' | 'prerequisite_for' }
export type NextStepTarget = { kind: 'lesson' | 'exam' | 'course' | 'opportunity'; id: string } | { kind: 'url'; url: string };
export interface NextStepBlock { id: string; type: 'next_step'; title: L10nString; description?: L10nString; target: NextStepTarget }

export type LessonBlock =
  | Exclude<ContentBlock, CalloutBlock<ContentBlock>> | CalloutBlock<LessonBlock>
  | QuizBlock | AssignmentBlock | ReflectionBlock | FlashcardsBlock
  | AccordionBlock<LessonBlock> | TabsBlock<LessonBlock> | RevealBlock<LessonBlock> | StepperBlock<LessonBlock>
  | ResourceLinkBlock | OpportunityLinkBlock | NextStepBlock;
export type { Question };
