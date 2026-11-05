'use client';

import { useId, useMemo, useState } from 'react';
import './studio-authoring.css';
import { NumberInput } from '@instructure/ui-number-input/v11_7';
import type { DocumentRef } from '@/content-engine/diagnostics';
import type { Locale } from '@/content-engine/schema/common';
import { CanvasButton as Button, CanvasTextInput, CanvasTextArea, CanvasCheckbox, CanvasSelect, CanvasFormFieldGroup } from '@/features/canvas/ui';
import courseSchema from '../../../../public/schemas/v1/course.json';
import lessonSchema from '../../../../public/schemas/v1/lesson.json';
import examSchema from '../../../../public/schemas/v1/exam.json';
import assignmentSchema from '../../../../public/schemas/v1/assignment.json';
import bankSchema from '../../../../public/schemas/v1/question_bundle.json';
import resourceSchema from '../../../../public/schemas/v1/resource.json';
import { record } from '../workspace-state';
import { authoringFieldLabel as fieldLabel, authoringVariantLabel as variantLabel, authoringValueLabel as valueLabel } from '../authoring-labels';
import { createAuthoringValue, matchingSchema, resolveAuthoringSchema, schemaVariants, visualDocument, type AuthoringSchema } from '../visual-authoring';

// Generated JSON imports infer optional undefined keys across union branches.
const schemas = { course: courseSchema, lesson: lessonSchema, exam: examSchema, assignment: assignmentSchema, question_bundle: bankSchema, resource: resourceSchema } as unknown as Record<string, AuthoringSchema>;
const copy = {
  en: { visual: 'Visual editor', inspect: 'Inspector', add: 'Add', remove: 'Remove', up: 'Move up', down: 'Move down', optional: 'Optional fields', empty: 'No entries yet.', variant: 'Format', language: 'Editing language', invalid: 'This document has invalid JSON. Your exact text is retained. Open JSON to repair it before using the visual editor.', unsupported: 'Open JSON to edit this document type.', palette: 'Add a block', blocks: 'Learning canvas', selected: 'Selected block', choose: 'Choose a block to edit its content and settings.', shared: 'Shared text', translate: 'Add translation', addProperty: 'Add entry', key: 'Entry key', metadata: 'Document settings', readonlyId: 'Stable identifier', missing: 'Not set', translation: 'Translation' },
  vi: { visual: 'Trình soạn trực quan', inspect: 'Thuộc tính', add: 'Thêm', remove: 'Xóa', up: 'Chuyển lên', down: 'Chuyển xuống', optional: 'Trường tùy chọn', empty: 'Chưa có nội dung.', variant: 'Định dạng', language: 'Ngôn ngữ soạn thảo', invalid: 'JSON của tài liệu chưa hợp lệ. Văn bản gốc vẫn được giữ nguyên. Mở JSON để sửa trước khi dùng trình soạn trực quan.', unsupported: 'Mở JSON để sửa loại tài liệu này.', palette: 'Thêm khối nội dung', blocks: 'Nội dung bài học', selected: 'Khối đã chọn', choose: 'Chọn khối để sửa nội dung và thiết lập.', shared: 'Văn bản chung', translate: 'Thêm bản dịch', addProperty: 'Thêm mục', key: 'Khóa của mục', metadata: 'Thiết lập tài liệu', readonlyId: 'Mã định danh cố định', missing: 'Chưa thiết lập', translation: 'Bản dịch' },
};
function freshId() { return `entry-${globalThis.crypto.randomUUID().slice(0, 12)}`; }

type FieldProps = {
  schema: AuthoringSchema; root: AuthoringSchema; value: unknown; label: string; path: string;
  locale: Locale; language: Locale; defaultLanguage: Locale; disabled: boolean; protectIds?: boolean; onChange: (value: unknown) => void;
};

function Field(props: FieldProps) {
  const { schema, root, value, label, path, locale, language, defaultLanguage, disabled, onChange } = props;
  const text = copy[locale];
  const id = useId();
  const [newKey, setNewKey] = useState('');
  const variants = schemaVariants(schema, root);
  const node = matchingSchema({ anyOf: variants }, root, value);
  const row = record(value);
  const localized = variants.find(option => option.type === 'object' && option.properties?.vi && option.properties?.en && Object.keys(option.properties).length === 2);
  if (localized) {
    const inner = localized.properties![language]!;
    const localizedValue = row && Object.keys(row).every(key => key === 'vi' || key === 'en');
    const current = localizedValue ? row[language] : language === defaultLanguage ? value : undefined;
    return <div className="space-y-2" data-authoring-field={path}>
      {!localizedValue && language === defaultLanguage ? <span className="text-xs text-muted-foreground">{text.shared}</span> : null}
      {current === undefined ? <div className="space-y-2"><p className="text-sm font-medium">{label} ({language.toUpperCase()})</p><Button variant="outline" size="sm" disabled={disabled} onClick={() => onChange({ ...(localizedValue ? row : { [defaultLanguage]: value }), [language]: createAuthoringValue(inner, root, freshId) })}>{text.translate}</Button></div> : <Field {...props} schema={inner} value={current} label={`${label} (${language.toUpperCase()})`} onChange={next => onChange(localizedValue ? { ...row, [language]: next } : next)} />}
    </div>;
  }
  const literalChoices = variants.every(option => option.const !== undefined);
  const discriminated = variants.some(option => option.properties?.type?.const !== undefined || option.properties?.kind?.const !== undefined);
  if (variants.length > 1 && !literalChoices && !discriminated) return <div className="space-y-3"><CanvasSelect label={`${label}: ${text.variant}`} value={String(variants.indexOf(node))} disabled={disabled} options={variants.map((option, index) => ({ value: String(index), label: variantLabel(option, locale) }))} onChange={value => onChange(createAuthoringValue(variants[Number(value)]!, root, freshId))} /><Field {...props} schema={node} /></div>;
  if (node.type === 'null') return <div className="text-sm text-muted-foreground">{label}: null</div>;
  if (node.const !== undefined && variants.length === 1) return <div className="flex items-center justify-between gap-3 text-sm"><span className="text-muted-foreground">{label}</span><span>{valueLabel(value ?? node.const, locale)}</span></div>;
  const protectedId = props.protectIds !== false && path.endsWith('/id') && value !== undefined;
  if (variants.length > 1 && variants.every(option => option.const !== undefined)) return <CanvasSelect id={id} label={label} value={String(value ?? '')} disabled={disabled} options={variants.map(option => ({ value: String(option.const), label: valueLabel(option.const, locale) }))} onChange={value => onChange(variants.find(option => String(option.const) === value)?.const)} />;
  if (node.type === 'object') {
    const fields = node.properties ?? {};
    const object = row ?? {};
    const priority = ['title', 'name', 'description', 'prompt', 'text', 'content'];
    const present = Object.keys(fields).filter(key => Object.hasOwn(object, key) || node.required?.includes(key)).sort((a, b) => (priority.includes(a) ? priority.indexOf(a) : 99) - (priority.includes(b) ? priority.indexOf(b) : 99));
    const absent = Object.keys(fields).filter(key => !present.includes(key));
    const technical = path === '' ? present.filter(key => ['$schema', 'schemaVersion', 'kind', 'id', 'type'].includes(key)) : [];
    const renderProperty = (key: string) => <div key={key} className="space-y-1"><Field {...props} schema={fields[key]!} value={object[key]} label={fieldLabel(key, locale)} path={`${path}/${key}`} onChange={next => onChange({ ...object, [key]: next })} />{!node.required?.includes(key) && key !== 'id' ? <button type="button" disabled={disabled} className="text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50" onClick={() => { const next = { ...object }; delete next[key]; onChange(next); }}>{text.remove} {fieldLabel(key, locale)}</button> : null}</div>;
    return <CanvasFormFieldGroup description={path === '' ? <span className="sr-only">{label}</span> : label} layout="stacked" rowSpacing="medium" data-authoring-field={path}>
      {variants.length > 1 && !node.properties?.type?.const ? <CanvasSelect label={text.variant} value={String(variants.indexOf(node))} disabled={disabled} options={variants.map((option, index) => ({ value: String(index), label: variantLabel(option, locale) }))} onChange={value => onChange(createAuthoringValue(variants[Number(value)]!, root, freshId))} /> : null}
      {present.filter(key => !technical.includes(key)).map(renderProperty)}
      {technical.length ? <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">{locale === 'vi' ? 'Định danh và lược đồ' : 'Identifiers and schema'}</summary><div className="mt-4 space-y-4">{technical.map(renderProperty)}</div></details> : null}
      {Object.keys(object).filter(key => !Object.hasOwn(fields, key)).map(key => <div key={key} className="space-y-1"><Field {...props} schema={typeof node.additionalProperties === 'object' ? node.additionalProperties : inferSchema(object[key])} value={object[key]} label={key} path={`${path}/${key}`} onChange={next => onChange({ ...object, [key]: next })} />{typeof node.additionalProperties === 'object' ? <button type="button" className="text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50" disabled={disabled} onClick={() => { const next = { ...object }; delete next[key]; onChange(next); }}>{text.remove} {key}</button> : null}</div>)}
      {absent.length ? <details><summary className="cursor-pointer text-sm text-muted-foreground">{text.optional}</summary><div className="mt-2 flex flex-wrap gap-2">{absent.map(key => <Button key={key} variant="outline" size="sm" disabled={disabled} onClick={() => onChange({ ...object, [key]: createAuthoringValue(fields[key]!, root, freshId) })}>{text.add} {fieldLabel(key, locale)}</Button>)}</div></details> : null}
      {typeof node.additionalProperties === 'object' ? <div className="flex flex-wrap gap-2"><CanvasTextInput label={`${label}: ${text.key}`} value={newKey} disabled={disabled} onChange={setNewKey} /><Button variant="outline" disabled={disabled || !newKey || Object.hasOwn(object, newKey) || ['__proto__', 'constructor', 'prototype'].includes(newKey)} onClick={() => { onChange({ ...object, [newKey]: createAuthoringValue(node.additionalProperties as AuthoringSchema, root, freshId) }); setNewKey(''); }}>{text.addProperty}</Button></div> : null}
    </CanvasFormFieldGroup>;
  }
  if (node.type === 'array') {
    const values = Array.isArray(value) ? value : [];
    const itemSchema = resolveAuthoringSchema(node.items ?? { type: 'string' }, root);
    const enumChoices = itemSchema.enum;
    if (enumChoices && itemSchema.type === 'string') return <CanvasFormFieldGroup description={label} layout="stacked" rowSpacing="small" data-authoring-field={path}>{enumChoices.map(choice => {
      const checked = values.includes(choice);
      return <CanvasCheckbox key={String(choice)} label={valueLabel(choice, locale)} checked={checked} disabled={disabled || (checked ? values.length <= (node.minItems ?? 0) : values.length >= (node.maxItems ?? Infinity))} onChange={next => onChange(next ? [...values, choice] : values.filter(value => value !== choice))} />;
    })}</CanvasFormFieldGroup>;
    if (['string', 'number', 'integer'].includes(String(itemSchema.type))) return <CanvasFormFieldGroup description={`${label} (${values.length})`} layout="stacked" rowSpacing="small" data-authoring-field={path}>
      {values.map((entry, index) => <div key={index} className="flex min-w-0 items-end gap-2"><div className="min-w-0 flex-1"><Field {...props} schema={itemSchema} value={entry} label={`${label} ${index + 1}`} path={`${path}/${index}`} onChange={next => onChange(values.map((value, i) => i === index ? next : value))} /></div><Button variant="outline" size="sm" disabled={disabled || values.length <= (node.minItems ?? 0)} aria-label={`${text.remove} ${label} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>{text.remove}</Button></div>)}
      <ArrayAdd schema={itemSchema} root={root} locale={locale} disabled={disabled || values.length >= (node.maxItems ?? Infinity)} onAdd={next => onChange([...values, next])} label={`${text.add} ${label}`} />
    </CanvasFormFieldGroup>;
    return <fieldset className="min-w-0 space-y-3" data-authoring-field={path}><legend className="mb-2 text-sm font-semibold">{label} <span className="text-muted-foreground">({values.length})</span></legend>
      {values.map((entry, index) => <details key={String(record(entry)?.id ?? index)} open={values.length === 1} className="rounded-md border border-border p-3"><summary className="cursor-pointer text-sm font-medium">{index + 1}. {typeof record(entry)?.type === 'string' ? fieldLabel(String(record(entry)?.type), locale) : label}</summary><div className="mt-3 space-y-3"><Field {...props} schema={node.items ?? inferSchema(entry)} value={entry} label={`${label} ${index + 1}`} path={`${path}/${index}`} onChange={next => onChange(values.map((item, i) => i === index ? next : item))} /><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={disabled || index === 0} aria-label={`${text.up} ${label} ${index + 1}`} onClick={() => { const next = [...values]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange(next); }}>{text.up}</Button><Button variant="outline" size="sm" disabled={disabled || index === values.length - 1} aria-label={`${text.down} ${label} ${index + 1}`} onClick={() => { const next = [...values]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; onChange(next); }}>{text.down}</Button><Button variant="outline" size="sm" disabled={disabled || values.length <= (node.minItems ?? 0)} aria-label={`${text.remove} ${label} ${index + 1}`} onClick={() => onChange(values.filter((_, i) => i !== index))}>{text.remove}</Button></div></div></details>)}
      {!values.length ? <p className="text-sm text-muted-foreground">{text.empty}</p> : null}
      <ArrayAdd schema={node.items ?? { type: 'string' }} root={root} locale={locale} disabled={disabled || values.length >= (node.maxItems ?? Infinity)} onAdd={next => onChange([...values, next])} label={`${text.add} ${label}`} />
    </fieldset>;
  }
  if (node.type === 'boolean') return <CanvasCheckbox label={label} checked={value === true} disabled={disabled} onChange={onChange} />;
  if (node.enum || (variants.length > 1 && variants.every(option => option.const !== undefined))) {
    const choices = node.enum ?? variants.map(option => option.const);
    return <CanvasSelect id={id} label={label} value={String(value ?? '')} disabled={disabled || protectedId} options={choices.map(choice => ({ value: String(choice), label: valueLabel(choice, locale) }))} onChange={value => onChange(choices.find(choice => String(choice) === value))} />;
  }
  if (node.type === 'number' || node.type === 'integer') return <NumberInput id={id} renderLabel={label} value={typeof value === 'number' ? value : ''} min={node.minimum} max={node.maximum} step={node.type === 'integer' ? 1 : 'any'} interaction={disabled ? 'disabled' : 'enabled'} onChange={(_event, input) => { if (input.trim() && Number.isFinite(Number(input))) onChange(Number(input)); }} onIncrement={() => onChange(Math.min(node.maximum ?? Infinity, (typeof value === 'number' ? value : 0) + 1))} onDecrement={() => onChange(Math.max(node.minimum ?? -Infinity, (typeof value === 'number' ? value : 0) - 1))} />;
  const singleLine = (schema.type === 'string' && /\/\d+$/.test(path)) || /\/(title|name|url|src|href|slug|email|alt|label|caption|\$schema)(\/(vi|en))?$/.test(path);
  return protectedId ? <CanvasTextInput id={id} label={label} value={String(value ?? '')} readOnly messages={[{ type: 'hint', text: text.readonlyId }]} /> : singleLine ? <CanvasTextInput id={id} label={label} value={typeof value === 'string' ? value : ''} disabled={disabled} maxLength={node.maxLength} onChange={onChange} /> : <CanvasTextArea id={id} label={label} height="5rem" resize="vertical" value={typeof value === 'string' ? value : value === null ? '' : String(value ?? '')} disabled={disabled} maxLength={node.maxLength} onChange={onChange} />;
}

function inferSchema(value: unknown): AuthoringSchema {
  return Array.isArray(value) ? { type: 'array', items: inferSchema(value[0]) } : record(value) ? { type: 'object', properties: Object.fromEntries(Object.entries(record(value)!).map(([key, child]) => [key, inferSchema(child)])) } : { type: typeof value };
}
function ArrayAdd({ schema, root, locale, disabled, onAdd, label }: { schema: AuthoringSchema; root: AuthoringSchema; locale: Locale; disabled: boolean; onAdd: (value: unknown) => void; label: string }) {
  const variants = schemaVariants(schema, root);
  const [variant, setVariant] = useState(0);
  return <div className="flex flex-wrap items-end gap-2">{variants.length > 1 ? <div className="min-w-0 flex-1"><CanvasSelect label={`${label}: ${copy[locale].variant}`} value={String(variant)} disabled={disabled} options={variants.map((option, index) => ({ value: String(index), label: variantLabel(option, locale) }))} onChange={value => setVariant(Number(value))} /></div> : null}<Button variant="outline" size="sm" disabled={disabled} onClick={() => onAdd(createAuthoringValue(variants[variant] ?? schema, root, freshId))}>{label}</Button></div>;
}

export function VisualEditor({ source, docRef, locale, defaultLanguage, readOnly, onChange, question = false }: { source: string; docRef: DocumentRef; locale: Locale; defaultLanguage: Locale; readOnly: boolean; question?: boolean; onChange: (value: unknown, expectedSource: string) => void }) {
  const [language, setLanguage] = useState<Locale>(defaultLanguage);
  const [selectedBlock, setSelectedBlock] = useState(0);
  const document = useMemo(() => visualDocument(source, docRef), [source, docRef]);
  const text = copy[locale];
  if (!document) return <div role="status" className="canvas-empty m-4 rounded-md border border-warning-border bg-warning p-4 text-sm text-warning-foreground">{text.invalid}</div>;
  const root = question ? schemas.question_bundle : schemas[String(document.kind)];
  if (!root) return <p className="p-4 text-sm text-muted-foreground">{text.unsupported}</p>;
  const settingsNames: Record<string, [string, string]> = { course: ['Course settings', 'Thông tin khóa học'], lesson: ['Lesson settings', 'Thiết lập bài học'], assignment: ['Assignment settings', 'Thiết lập bài tập'], exam: ['Exam settings', 'Thiết lập bài thi'], resource: ['Resource settings', 'Thiết lập tài nguyên'], question: ['Question settings', 'Thiết lập câu hỏi'] };
  const settingsLabel = settingsNames[question ? 'question' : String(document.kind)]?.[locale === 'vi' ? 1 : 0] ?? text.metadata;
  const documentSchema = question ? matchingSchema(resolveAuthoringSchema(root.properties!.questions!, root).items!, root, document) : root;
  const blocks = Array.isArray(document.blocks) ? document.blocks : null;
  const blockSchema = root.properties?.blocks ? resolveAuthoringSchema(root.properties.blocks, root).items : undefined;
  const selected = Math.min(selectedBlock, Math.max(0, (blocks?.length ?? 0) - 1));
  const props = { root, locale, language, defaultLanguage, disabled: readOnly };
  const metadata = blocks ? { ...documentSchema, required: documentSchema.required?.filter(key => key !== 'blocks'), properties: Object.fromEntries(Object.entries(documentSchema.properties ?? {}).filter(([key]) => key !== 'blocks')) } : documentSchema;
  return <div aria-label={text.visual} className="studio-visual-editor min-h-full space-y-5 p-4 sm:p-5" lang={language}>
    <div className="canvas-toolbar flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{text.visual}</h2><div className="w-44"><CanvasSelect label={text.language} value={language} options={[{ value: 'vi', label: 'Tiếng Việt' }, { value: 'en', label: 'English' }]} onChange={value => setLanguage(value as Locale)} /></div></div>
    {blocks && blockSchema ? <>
      <section aria-label={text.blocks} className="space-y-3"><CanvasSelect label={`${text.blocks} (${blocks.length})`} value={String(selected)} options={blocks.map((block, index) => ({ value: String(index), label: `${index + 1}. ${fieldLabel(String(record(block)?.type ?? 'content'), locale)} — ${blockSummary(block, language)}` }))} onChange={value => setSelectedBlock(Number(value))} />
      </section>
      {blocks[selected] !== undefined ? <section aria-label={text.inspect} className="canvas-panel space-y-3 border-t border-border pt-5"><h3 className="text-sm font-semibold">{text.inspect} · {selected + 1}</h3><Field {...props} schema={blockSchema} value={blocks[selected]} label={text.selected} path={`/blocks/${selected}`} onChange={next => onChange({ ...document, blocks: blocks.map((block, index) => index === selected ? next : block) }, source)} /><div className="flex flex-wrap gap-2"><Button variant="outline" size="sm" disabled={readOnly || selected === 0} onClick={() => { const next = [...blocks]; [next[selected - 1], next[selected]] = [next[selected], next[selected - 1]]; onChange({ ...document, blocks: next }, source); setSelectedBlock(selected - 1); }}>{text.up}</Button><Button variant="outline" size="sm" disabled={readOnly || selected >= blocks.length - 1} onClick={() => { const next = [...blocks]; [next[selected], next[selected + 1]] = [next[selected + 1], next[selected]]; onChange({ ...document, blocks: next }, source); setSelectedBlock(selected + 1); }}>{text.down}</Button><Button variant="outline" size="sm" disabled={readOnly || blocks.length <= 1} onClick={() => onChange({ ...document, blocks: blocks.filter((_, index) => index !== selected) }, source)}>{text.remove}</Button></div></section> : null}
      <details className="border-t border-border pt-3"><summary className="cursor-pointer text-sm font-medium">{text.palette}</summary><div className="mt-3"><ArrayAdd schema={blockSchema} root={root} locale={locale} disabled={readOnly || blocks.length >= 400} label={text.palette} onAdd={next => { onChange({ ...document, blocks: [...blocks, next] }, source); setSelectedBlock(blocks.length); }} /></div></details>
    </> : null}
    <details open={!blocks} className="border-t border-border pt-4"><summary className="cursor-pointer text-sm font-semibold">{settingsLabel}</summary><div className="mt-4"><Field {...props} schema={metadata} value={blocks ? Object.fromEntries(Object.entries(document).filter(([key]) => key !== 'blocks')) : document} label={settingsLabel} path="" onChange={next => onChange(blocks ? { ...record(next), blocks } : next, source)} /></div></details>
  </div>;
}
function blockSummary(block: unknown, language: Locale): string {
  const row = record(block);
  const content = row?.content;
  if (Array.isArray(content)) return content.map(run => { const text = record(run)?.text; return typeof text === 'string' ? text : String(record(text)?.[language] ?? ''); }).join('').slice(0, 140);
  const value = row?.title ?? row?.code ?? row?.latex ?? row?.alt ?? row?.id;
  return typeof value === 'string' ? value.slice(0, 140) : String(record(value)?.[language] ?? '');
}

/** Structured subdocument controls reuse the published rich-content schema. */
export function StructuredContentEditor({ value, onChange, locale, defaultLanguage = locale, disabled, label, kind = 'rich' }: { value: unknown; onChange: (value: unknown) => void; locale: Locale; defaultLanguage?: Locale; disabled: boolean; label: string; kind?: 'rich' | 'record' }) {
  const [language, setLanguage] = useState<Locale>(defaultLanguage);
  const recordValue: AuthoringSchema = { $ref: '#/$defs/StudioRecordValue' };
  const root: AuthoringSchema = kind === 'rich' ? schemas.resource : { $defs: { StudioRecordValue: { anyOf: [
    { type: 'string' }, { type: 'number' }, { type: 'boolean' }, { type: 'null' },
    { type: 'object', additionalProperties: recordValue }, { type: 'array', items: recordValue },
  ] } } };
  const schema: AuthoringSchema = kind === 'rich' ? root.properties!.body! : { type: 'object', additionalProperties: recordValue };
  return <div className="studio-visual-editor min-w-0 space-y-4">
    {kind === 'rich' ? <CanvasSelect label={copy[locale].language} value={language} options={[{ value: 'vi', label: 'Tiếng Việt' }, { value: 'en', label: 'English' }]} onChange={value => setLanguage(value as Locale)} /> : null}
    <Field root={root} schema={schema} value={value} label={label} path="" locale={locale} language={language} defaultLanguage={defaultLanguage} disabled={disabled} protectIds={kind === 'rich'} onChange={onChange} />
  </div>;
}
