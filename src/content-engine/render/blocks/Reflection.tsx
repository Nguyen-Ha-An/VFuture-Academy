'use client';
import { useId, useState } from 'react';
import type { ReflectionBlock } from '../../schema/types';
import type { BlockRendererProps } from '../registry';
import { RichContentView } from '../RichContentView';
import { asRich } from '../text';
import { blockFrame, buttonClass, fieldClass } from '../tone';
export function Reflection({ block, runtime, path, depth }: BlockRendererProps<ReflectionBlock>) {
  const id = useId();
  const saved = runtime.getBlockState<{ text: string }>(block.id);
  const [text, setText] = useState(saved?.text ?? '');
  const min = block.minChars ?? 0, max = block.maxChars ?? 2000;
  const ok = text.trim().length >= min && text.length <= max;
  const vi = runtime.locale === 'vi';
  const save = () => { runtime.setBlockState(block.id, { text, savedAt: new Date().toISOString() }); if (ok) runtime.onActivityComplete(block.id); };
  return (
    <section className={blockFrame(depth)}>
      <div id={id} className="mb-2 font-medium"><RichContentView content={asRich(block.prompt)} runtime={runtime} path={`${path}/prompt`} /></div>
      <textarea aria-labelledby={id} value={text} onChange={(e) => setText(e.target.value)} maxLength={max} rows={4} className={`w-full p-2 ${fieldClass()}`} />
      <div className="mt-2 flex items-center justify-between gap-3 text-sm text-muted-foreground"><span>{text.length}/{max}{min ? ` · ${vi ? 'tối thiểu' : 'min'} ${min}` : ''}{block.required ? ` · ${vi ? 'bắt buộc' : 'required'}` : ''}</span><button type="button" onClick={save} disabled={!ok && block.required} className={buttonClass.primary}>{vi ? 'Lưu' : 'Save'}</button></div>
    </section>
  );
}
