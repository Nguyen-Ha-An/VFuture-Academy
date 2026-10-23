'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { AssignmentTarget } from '../assignment-contracts';
import { allowedSubmissionUrl } from '../assignment-contracts';
import type { QuestionRendererProps } from '../registry';
import type { AssignmentPayload } from '../runtime';
import { QuestionFrame } from './QuestionFrame';
import { DraftInput, DraftTextarea } from './draft';
import type { UploadAnswerQuestion } from './types';
import { t } from './types';
import { RubricTable } from './Essay';
import { CodeEditor } from '../CodeEditor';
import { buttonClass, fieldClass } from '../tone';

type UploadState = {
  id: string;
  file: File;
  status: 'uploading' | 'failed' | 'cancelled';
  percent: number;
  controller: AbortController;
};

export interface SubmissionFieldsProps {
  accepts: string[];
  value: AssignmentPayload;
  onChange: (value: AssignmentPayload) => void;
  disabled?: boolean;
  runtime: QuestionRendererProps['runtime'];
  assignmentTarget?: AssignmentTarget;
  maxFiles?: number;
  maxFileSizeMB?: number;
  allowedMimeTypes?: string[];
  linkHosts?: string[];
  codeLanguage?: string;
  onUploadBusyChange?: (busy: boolean) => void;
}

export function SubmissionFields({
  accepts,
  value,
  onChange,
  disabled,
  runtime,
  assignmentTarget,
  maxFiles = 3,
  maxFileSizeMB = 20,
  allowedMimeTypes,
  linkHosts,
  codeLanguage,
  onUploadBusyChange,
}: SubmissionFieldsProps) {
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadState[]>([]);
  const sequenceRef = useRef(0);
  const activeUploadIdsRef = useRef(new Set<string>());
  const valueRef = useRef(value);
  valueRef.current = value;
  const linkUrlId = useId();
  const L = runtime.locale;
  const files = value.files ?? [];
  const links = value.links ?? [];
  const emit = (next: AssignmentPayload) => {
    valueRef.current = next;
    onChange(next);
  };

  useEffect(() => {
    onUploadBusyChange?.(uploads.some(({ status }) => status === 'uploading'));
  }, [onUploadBusyChange, uploads]);

  const updateUpload = (id: string, update: Partial<UploadState>) => {
    setUploads((current) => current.map((entry) => entry.id === id ? { ...entry, ...update } : entry));
  };

  const beginUpload = (file: File, existingId?: string) => {
    const id = existingId ?? `${file.name}:${file.size}:${file.lastModified}:${sequenceRef.current++}`;
    if (activeUploadIdsRef.current.has(id)) return;
    activeUploadIdsRef.current.add(id);
    const controller = new AbortController();
    const entry: UploadState = { id, file, status: 'uploading', percent: 0, controller };
    setUploads((current) => existingId
      ? current.map((candidate) => candidate.id === id ? entry : candidate)
      : [...current, entry]);
    const upload = assignmentTarget
      ? runtime.uploadAssignmentFile(assignmentTarget, file, {
        signal: controller.signal,
        onProgress: ({ percent }) => updateUpload(id, { percent }),
      })
      : runtime.uploadFile(file);
    void upload.then((uploaded) => {
      const current = valueRef.current;
      const next = { ...current, files: [...(current.files ?? []), uploaded] };
      emit(next);
      activeUploadIdsRef.current.delete(id);
      setUploads((pending) => pending.filter((candidate) => candidate.id !== id));
    }).catch((uploadError: unknown) => {
      const cancelled = typeof uploadError === 'object'
        && uploadError !== null
        && 'code' in uploadError
        && uploadError.code === 'UPLOAD_CANCELLED';
      activeUploadIdsRef.current.delete(id);
      updateUpload(id, { status: cancelled ? 'cancelled' : 'failed' });
    });
  };

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    const accepted: File[] = [];
    let problem: string | null = null;
    for (const file of Array.from(list)) {
      if (files.length + uploads.length + accepted.length >= maxFiles) {
        problem = t(L, `Tối đa ${maxFiles} tệp`, `At most ${maxFiles} files`);
        break;
      }
      if (allowedMimeTypes?.length && !allowedMimeTypes.includes(file.type)) {
        problem = t(L, `Định dạng không được chấp nhận: ${file.type || file.name}`, `File type not accepted: ${file.type || file.name}`);
        continue;
      }
      if (file.size > maxFileSizeMB * 1024 * 1024) {
        problem = t(L, `Tệp quá lớn (tối đa ${maxFileSizeMB} MB)`, `File too large (max ${maxFileSizeMB} MB)`);
        continue;
      }
      accepted.push(file);
    }
    setError(problem);
    for (const file of accepted) beginUpload(file);
  };

  const addLink = () => {
    if (!allowedSubmissionUrl(link, linkHosts)) {
      const hosts = linkHosts?.length ? linkHosts.join(', ') : null;
      setError(hosts
        ? t(L, `Liên kết phải dùng HTTPS và thuộc máy chủ được phép: ${hosts}`, `Link must use HTTPS and an allowed host: ${hosts}`)
        : t(L, 'Liên kết phải dùng HTTPS và thuộc máy chủ được phép', 'Link must use HTTPS and an allowed host'));
      return;
    }
    setError(null);
    const next = { ...valueRef.current, links: [...(valueRef.current.links ?? []), { url: link }] };
    emit(next);
    setLink('');
  };

  return (
    <div className="space-y-3">
      {accepts.includes('file') ? (
        <div>
          <label className="block text-sm font-medium">
            {t(L, 'Tải tệp lên', 'Upload files')}
            <input
              type="file"
              multiple
              disabled={disabled || files.length + uploads.length >= maxFiles}
              accept={allowedMimeTypes?.join(',')}
              onChange={(event) => {
                onFiles(event.currentTarget.files);
                event.currentTarget.value = '';
              }}
              className="mt-1 block text-sm"
            />
          </label>
          <ul className="mt-2 space-y-2 text-sm">
            {files.map((file) => (
              <li key={file.assetId} className="flex items-center gap-2">
                <span>{file.name}</span>
                <span className="text-muted-foreground">({Math.ceil(file.size / 1024)} KB)</span>
                {!disabled ? <button type="button" onClick={() => emit({ ...valueRef.current, files: (valueRef.current.files ?? []).filter((candidate) => candidate.assetId !== file.assetId) })} className="text-destructive underline">{t(L, 'xoá', 'remove')}</button> : null}
              </li>
            ))}
            {uploads.map((upload) => (
              <li key={upload.id} className="rounded-md border border-border p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span>{upload.file.name}</span>
                  {upload.status === 'uploading' ? <span role="progressbar" aria-label={t(L, `Tiến trình tải ${upload.file.name}`, `Upload progress for ${upload.file.name}`)} aria-valuemin={0} aria-valuemax={100} aria-valuenow={upload.percent}>{upload.percent}%</span> : null}
                  {upload.status === 'failed' ? <span className="text-destructive" role="alert">{t(L, `Tải lên thất bại: ${upload.file.name}`, `Upload failed for ${upload.file.name}`)}</span> : null}
                  {upload.status === 'cancelled' ? <span>{t(L, `Đã huỷ tải lên: ${upload.file.name}`, `Upload cancelled for ${upload.file.name}`)}</span> : null}
                </div>
                {upload.status === 'uploading' ? <button type="button" disabled={disabled} onClick={() => upload.controller.abort()} className="mt-1 underline disabled:opacity-50">{t(L, `Huỷ ${upload.file.name}`, `Cancel ${upload.file.name}`)}</button> : (
                  <div className="mt-1 flex gap-3">
                    <button type="button" disabled={disabled} onClick={() => beginUpload(upload.file, upload.id)} className="underline disabled:opacity-50">{t(L, `Thử lại ${upload.file.name}`, `Retry ${upload.file.name}`)}</button>
                    <button type="button" disabled={disabled} onClick={() => setUploads((current) => current.filter((candidate) => candidate.id !== upload.id))} className="text-destructive underline disabled:opacity-50">{t(L, `Xoá ${upload.file.name}`, `Remove ${upload.file.name}`)}</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {accepts.includes('link') ? (
        <div>
          <label className="block text-sm font-medium" htmlFor={linkUrlId}>{t(L, 'Liên kết', 'Link URL')}</label>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row">
            <DraftInput id={linkUrlId} type="url" aria-label={t(L, 'Liên kết', 'Link URL')} value={link} disabled={disabled} onValueChange={setLink} placeholder="https://" className={`min-w-0 w-full flex-1 p-2 ${fieldClass()}`} />
            <button type="button" onClick={addLink} disabled={disabled || !link} className={`${buttonClass.secondary} w-full sm:w-auto`}>{t(L, 'Thêm liên kết', 'Add link')}</button>
          </div>
          <ul className="mt-1 text-sm">{links.map((item, index) => <li key={`${item.url}-${index}`} className="flex items-center gap-2"><a href={item.url} target="_blank" rel="noopener noreferrer" className="underline">{item.url}</a>{!disabled ? <button type="button" onClick={() => emit({ ...valueRef.current, links: (valueRef.current.links ?? []).filter((_, itemIndex) => itemIndex !== index) })} className="text-destructive underline">{t(L, 'xoá', 'remove')}</button> : null}</li>)}</ul>
        </div>
      ) : null}
      {accepts.includes('text') ? <label className="block text-sm font-medium">{t(L, 'Ghi chú', 'Notes')}<DraftTextarea aria-label={t(L, 'Ghi chú', 'Notes')} rows={4} value={value.text ?? ''} disabled={disabled} onValueChange={(text) => emit({ ...valueRef.current, text })} className={`mt-1 w-full p-2 ${fieldClass()}`} /></label> : null}
      {accepts.includes('code') ? <CodeEditor ariaLabel={t(L, 'Trình soạn mã', 'code editor')} value={value.code?.code ?? ''} language={value.code?.language ?? codeLanguage ?? 'plaintext'} disabled={disabled} onChange={(code) => emit({ ...valueRef.current, code: { language: valueRef.current.code?.language ?? codeLanguage ?? 'plaintext', code } })} /> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

export function UploadAnswer(props: QuestionRendererProps<UploadAnswerQuestion>) {
  const { question: q, value, onChange, disabled, runtime } = props;
  const assignmentPayload = (value && typeof value === 'object' ? value : {}) as AssignmentPayload;
  return <QuestionFrame {...props}><SubmissionFields accepts={q.accepts} value={assignmentPayload} onChange={onChange} disabled={disabled} runtime={runtime} maxFiles={q.maxFiles} maxFileSizeMB={q.maxFileSizeMB} allowedMimeTypes={q.allowedMimeTypes} linkHosts={q.linkHosts} />{q.rubric ? <RubricTable rubric={q.rubric} locale={runtime.locale} /> : null}</QuestionFrame>;
}
