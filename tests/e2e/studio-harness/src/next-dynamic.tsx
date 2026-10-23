import { lazy, Suspense, type ComponentType } from 'react';

/**
 * Browser-harness stand-in for `next/dynamic`: React.lazy plus the `loading` fallback. The kit's
 * ChartCard loads its Recharts bodies this way, so the harness exercises the same lazy split.
 */
type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };

export default function dynamic<P extends object>(
  loader: () => Promise<Loaded<P>>,
  options: { loading?: ComponentType; ssr?: boolean } = {},
): ComponentType<P> {
  const Lazy = lazy(async () => {
    const loaded = await loader();
    return 'default' in loaded ? loaded : { default: loaded };
  });
  const Loading = options.loading;
  function Dynamic(props: P) {
    return <Suspense fallback={Loading ? <Loading /> : null}><Lazy {...props} /></Suspense>;
  }
  return Dynamic;
}
