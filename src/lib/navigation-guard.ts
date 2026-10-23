type NavigationGuard = () => Promise<boolean>;

const guards = new Set<NavigationGuard>();
let inFlightRequest: Promise<boolean> | undefined;

export function registerNavigationGuard(guard: NavigationGuard): () => void {
  guards.add(guard);

  return () => {
    guards.delete(guard);
  };
}

export function requestNavigation(): Promise<boolean> {
  if (inFlightRequest) {
    return inFlightRequest;
  }

  const snapshot = [...guards];
  const request = evaluateGuards(snapshot);
  inFlightRequest = request;

  request.then(() => {
    if (inFlightRequest === request) {
      inFlightRequest = undefined;
    }
  });

  return request;
}

async function evaluateGuards(snapshot: NavigationGuard[]): Promise<boolean> {
  for (const guard of snapshot) {
    try {
      if (!(await guard())) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}
