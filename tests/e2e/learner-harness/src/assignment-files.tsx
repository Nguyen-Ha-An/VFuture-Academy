import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SubmissionFields } from '@/content-engine/render/questions/UploadAnswer';
import type { AssignmentPayload } from '@/content-engine/render/runtime';
import { createApiRuntime } from '@/features/runtime/api-runtime';

const runtime = createApiRuntime({ courseId: 'pilot-course', itemId: 'pilot-assignment', locale: 'en', initialState: {} });

function AssignmentAttachmentFixture() {
  const [value, setValue] = useState<AssignmentPayload>({});
  return <SubmissionFields accepts={['file']} value={value} onChange={setValue} runtime={runtime}
    assignmentTarget={{ blockId: null }} maxFiles={1} maxFileSizeMB={4} allowedMimeTypes={['application/pdf']} />;
}

createRoot(document.getElementById('root')!).render(<AssignmentAttachmentFixture />);
