import { analyzeWorkspaceState, type WorkspaceAnalysisRequest, type WorkspaceAnalysisResponse } from './workspace-analysis';
import { measureStudioOperation } from './studio-performance';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkspaceAnalysisRequest>) => void) | null;
  postMessage: (value: WorkspaceAnalysisResponse) => void;
};

scope.onmessage = (event) => {
  const { id, revision, state } = event.data;
  const analysis = measureStudioOperation('studio.workspace.analysis', () => analyzeWorkspaceState(state));
  scope.postMessage({ id, revision, analysis });
};
