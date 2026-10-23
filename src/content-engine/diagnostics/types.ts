import type { DiagnosticCode } from './codes';
import type { DocumentRef } from './refs';

export type Severity = 'error' | 'warning' | 'info';
export interface Position { line: number; col: number }          // 1-based
export interface Range { start: Position; end: Position }
export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  ref?: DocumentRef;                                              // authoritative reference; producers always set it
  docId: string;                                                  // legacy label, always refLabel(ref)
  path: string;                                                   // JSON pointer ('' = whole document)
  message: { vi: string; en: string };
  hint?: { vi: string; en: string };
  range?: Range;
  revision?: string;                                              // source revision this was computed from
  meta?: Record<string, string | number>;
}
export interface ValidationSummary {
  modules: number;
  items: { lesson: number; exam: number; assignment: number };
  blocks: number;
  questions: Record<string, number>;
  totalPoints: number;
  languages: string[];
}
export interface ValidationReport { ok: boolean; errors: Diagnostic[]; warnings: Diagnostic[]; summary: ValidationSummary; revision?: string }
export const emptySummary = (): ValidationSummary => ({ modules: 0, items: { lesson: 0, exam: 0, assignment: 0 }, blocks: 0, questions: {}, totalPoints: 0, languages: [] });
