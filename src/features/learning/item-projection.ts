import { LEARNER_FORBIDDEN_KEYS } from '@/content-engine/compile/project';
import { quizFeedbackForSettings } from '@/content-engine/schema/activities';
import { recordOf, type OutlineItem } from './shared';

const privilegedKeys = new Set<string>(LEARNER_FORBIDDEN_KEYS);
const itemKeys = new Set<string>([...privilegedKeys, 'optionFeedback']);

function projectValue(value: unknown, forbidden: ReadonlySet<string>, projectItem: boolean, feedbackPolicy?: string): unknown {
  if (Array.isArray(value)) return value.map(entry => projectValue(entry, forbidden, projectItem));
  const object = recordOf(value);
  if (!object) return value;
  return Object.fromEntries(Object.entries(object).flatMap(([key, nested]) => {
    if (forbidden.has(key) && !(key === 'feedback' && feedbackPolicy !== undefined && nested === feedbackPolicy)) return [];
    const policy = projectItem ? quizFeedbackForSettings(object, key) : undefined;
    return [[key, projectValue(nested, forbidden, projectItem, policy)]];
  }));
}

export function sanitizedLearnerValue(value: unknown, forbidden = privilegedKeys): unknown {
  return projectValue(value, forbidden, false);
}

/** An exam's introduction is available before a learner starts a particular attempt. */
export function learnerItemProjection(item: Pick<OutlineItem, 'id' | 'type'>, payload: unknown): unknown {
  if (item.type !== 'exam') return projectValue(payload, itemKeys, true);
  const render = recordOf(payload);
  return projectValue({
    id: item.id,
    kind: 'exam',
    title: render?.title,
    description: render?.description,
    settings: render?.settings,
    sections: [],
  }, itemKeys, true);
}
