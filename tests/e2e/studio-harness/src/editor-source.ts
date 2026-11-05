import { EditorView } from '@codemirror/view';

declare global {
  interface Window { __studioEditorSource?: () => string }
}
// CodeMirror virtualizes off-screen lines. Browser losslessness checks read its
// actual document, rather than mistaking the visible DOM subset for the source.
window.__studioEditorSource = () => {
  const editor = document.querySelector<HTMLElement>('.cm-content');
  return editor ? EditorView.findFromDOM(editor)?.state.doc.toString() ?? '' : '';
};
