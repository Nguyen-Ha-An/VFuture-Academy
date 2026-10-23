'use client';
import { BenchFault } from '@/features/workspace-ui/learner/BenchFault';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <BenchFault digest={error.digest} reset={reset} />;
}
