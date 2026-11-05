import { playerKey, resolvePlayer } from '../manifest/players';
import type { QuestionType } from '../schema/questions';
import { questionRegistry, UnavailableBlock, type QuestionRendererProps } from './registry';

export function QuestionRenderer(props: QuestionRendererProps) {
  const { question, runtime } = props;
  const r = resolvePlayer(question.type as QuestionType, question.display?.interactionType);
  const key = r.ok ? playerKey(r.player.type, r.player.interactionType) : `${question.type}:${question.display?.interactionType ?? 'default'}`;
  const C = r.ok ? questionRegistry[key] : undefined;
  if (!C) return <UnavailableBlock type={key} locale={runtime.locale} />;
  const controls = question.type === 'question_group' ? undefined : props.leafControls?.(question, props.value, props.onChange);
  const controlledProps = {
    ...props,
    disabled: props.disabled || controls?.disabled,
    result: controls?.result ?? props.result,
    revealed: controls?.revealed ?? props.revealed,
  };
  return <><C {...(controlledProps as QuestionRendererProps<never>)} />{controls?.actions}</>;
}
