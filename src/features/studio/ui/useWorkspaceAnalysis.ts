"use client";

import { useEffect, useMemo, useRef, useState } from 'react';

import { sourcesRevision } from '@/content-engine/validate/revision';
import type { WorkspaceState } from '../workspace-state';
import {
  analyzeWorkspaceState,
  type WorkspaceAnalysis,
  type WorkspaceAnalysisRequest,
  type WorkspaceAnalysisResponse,
} from './workspace-analysis';
import { measureStudioOperation } from './studio-performance';

export { analyzeWorkspaceState, createWorkspaceAnalysisCache } from './workspace-analysis';

const ANALYSIS_DEBOUNCE_MS = 200;

export function useWorkspaceAnalysis(state: WorkspaceState): WorkspaceAnalysis & { revision: string; pending: boolean } {
  const sourceRevision = useMemo(() => sourcesRevision(state.sources), [state.sources]);
  const requestedRevision = `${sourceRevision}:${state.baseVersionId ?? ''}`;
  const [result, setResult] = useState(() => ({
    revision: requestedRevision,
    validated: false,
    // Server-loaded drafts are already parsed. This supplies the first preview
    // without repeating whole-workspace validation on the rendering thread.
    analysis: { payload: { manifest: state.manifest, items: state.items, baseVersionId: state.baseVersionId }, diagnostics: [] } as WorkspaceAnalysis,
  }));
  const worker = useRef<Worker | null>(null);
  const requestId = useRef(0);
  const latest = useRef<{ id: number; revision: string; state: WorkspaceState } | null>(null);

  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    const instance = new Worker('/studio-workers/workspace-analysis.js', { type: 'module' });
    worker.current = instance;
    instance.onmessage = (event: MessageEvent<WorkspaceAnalysisResponse>) => {
      const pending = latest.current;
      if (!pending || event.data.id !== pending.id || event.data.revision !== pending.revision) return;
      setResult({ revision: event.data.revision, validated: true, analysis: event.data.analysis });
    };
    instance.onerror = () => {
      const pending = latest.current;
      if (!pending) return;
      setResult({
        revision: pending.revision,
        validated: true,
        analysis: measureStudioOperation('studio.workspace.analysis', () => analyzeWorkspaceState(pending.state)),
      });
    };
    return () => { instance.terminate(); worker.current = null; };
  }, []);

  useEffect(() => {
    if (result.validated && result.revision === requestedRevision) return;
    const request: WorkspaceAnalysisRequest = { id: ++requestId.current, revision: requestedRevision, state };
    // Supersede an in-flight response as soon as text changes. Waiting until the
    // debounce fires would let obsolete analysis reset the newer timer.
    latest.current = request;
    const timer = window.setTimeout(() => {
      if (worker.current) worker.current.postMessage(request);
      else setResult({
        revision: requestedRevision,
        validated: true,
        analysis: measureStudioOperation('studio.workspace.analysis', () => analyzeWorkspaceState(state)),
      });
    }, ANALYSIS_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [requestedRevision, result.revision, result.validated, state]);

  const current = result.revision === requestedRevision;
  return {
    payload: current ? result.analysis.payload : null,
    diagnostics: current ? result.analysis.diagnostics : [],
    revision: current ? sourceRevision : result.revision.split(':', 1)[0] ?? result.revision,
    pending: !current || !result.validated,
  };
}
