import { playerKey, resolvePlayer } from '../manifest/players';
import type { QuestionType } from '../schema/questions';
import { questionRegistry, UnavailableBlock, type QuestionRendererProps } from './registry';

export function QuestionRenderer(props: QuestionRendererProps) {
  const { question, runtime } = props;
  const r = resolvePlayer(question.type as QuestionType, question.display?.interactionType);
  const key = r.ok ? playerKey(r.player.type, r.player.interactionType) : `${question.type}:${question.display?.interactionType ?? 'default'}`;
  const C = r.ok ? questionRegistry[key] : undefined;
  return C ? <C {...(props as QuestionRendererProps<never>)} /> : <UnavailableBlock type={key} locale={runtime.locale} />;
}
