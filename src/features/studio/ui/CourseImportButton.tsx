'use client';

import { ImportDialog } from './ImportDialog';

export function CourseImportButton() {
  return <ImportDialog courseId="" manifest={null} items={{}} createOnly canCreate onApply={() => undefined} />;
}
