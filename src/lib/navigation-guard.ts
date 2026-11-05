export type NavigationIntent = { kind: 'route' } | { kind: 'document'; signal: AbortSignal };
type NavigationGuard = (intent?: NavigationIntent) => Promise<boolean>;

const guards = new Set<NavigationGuard>();
let inFlightRequest: Promise<boolean> | undefined;

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.add(guard);

  return () => {
    guards.delete(guard);
  };
}

export function requestNavigation(intent?: NavigationIntent): Promise<boolean> {
  if (intent?.kind === 'document' && intent.signal.aborted) return Promise.resolve(false);
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const snapshot = [...guards];
  const request = evaluateGuards(snapshot, intent);
  inFlightRequest = request;

  request.then(() => {
    if (inFlightRequest === request) {
      inFlightRequest = undefined;
    }
  });

  return request;
}

async function evaluateGuards(snapshot: NavigationGuard[], intent?: NavigationIntent): Promise<boolean> {
  for (const guard of snapshot) {
    try {
      if (!(await guard(intent)) || (intent?.kind === 'document' && intent.signal.aborted)) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}
