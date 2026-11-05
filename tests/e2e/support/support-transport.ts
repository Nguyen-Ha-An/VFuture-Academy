import { supportReviewParam } from './support-review-state';
/** Synthetic, session-scoped browser transport for real supporting UI components. Never calls production. */
export type SupportFixtureState = {
  handle: string | null;
  profilePublic: boolean;
  interests: Record<string, boolean>;
  proposals: Record<string, unknown>;
  attempts: Record<string, number>;
};
const storageKey = 'academy-support-review:records';
function initialState(): SupportFixtureState {
  const empty: SupportFixtureState = { handle: null, profilePublic: false, interests: {}, proposals: {}, attempts: {} };
  try {
    if (new URLSearchParams(location.search).get('supportState') === 'baseline') { sessionStorage.removeItem(storageKey); return empty; }
    const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as SupportFixtureState | null;
    return saved && typeof saved.profilePublic === 'boolean' && saved.interests && saved.proposals && saved.attempts ? saved : empty;
  } catch { return empty; }
}
const fixture = initialState();
function persist() { try { sessionStorage.setItem(storageKey, JSON.stringify(fixture)); } catch { /* Local review still works in memory. */ } }
export function supportFixtureState() { return fixture; }
export function seedSupportProfile(handle: string | null, profilePublic: boolean) {
  if (!fixture.attempts['/api/v1/profile/handle']) fixture.handle = handle;
  if (!fixture.attempts['/api/v1/profile/public']) fixture.profilePublic = profilePublic;
  persist();
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createSupportTransport(fallback: typeof fetch): typeof fetch {
  // Browser tests inspect only these synthetic records, never an application account.
  (window as Window & { __academySupportFixture?: SupportFixtureState }).__academySupportFixture = fixture;
  return async (input, init) => {
    const request = input instanceof Request ? input : new Request(new URL(String(input), location.origin), init);
    const url = new URL(request.url);
    const path = url.pathname;
    const supported = path === '/api/v1/profile/handle' || path === '/api/v1/profile/public' || path === '/api/v1/projects' || /^\/api\/v1\/(projects|opportunities)\/[^/]+\/interest$/.test(path);
    if (!supported || request.method === 'GET') return fallback(input, init);
    // A deliberately local contract: known fields/actions only; unknown URLs use the owning harness.
    const mutation = supportReviewParam('supportMutation') ?? (supportReviewParam('supportState') === 'pending' ? 'pending' : 'success');
    fixture.attempts[path] = (fixture.attempts[path] ?? 0) + 1;
    persist();
    if (mutation === 'pending') await new Promise(resolve => setTimeout(resolve, 1500));
    if (mutation === 'error' || (mutation === 'retry' && fixture.attempts[path] === 1)) return reply(503, { error: { code: 'FIXTURE_FAILURE', message: 'Synthetic supporting UI failure' } });
    if (mutation === 'conflict') return reply(409, { error: { code: path === '/api/v1/projects' ? 'PROJECT_EXISTS' : 'HANDLE_TAKEN', message: 'Synthetic conflict' } });
    if (mutation === 'rate-limit') return reply(429, { error: { code: 'RATE_LIMITED', message: 'Synthetic rate limit' } });
    const body = await request.json() as Record<string, unknown>;
    if (path === '/api/v1/profile/handle') {
      if (request.method !== 'PATCH' || typeof body.handle !== 'string') return reply(400, { error: { code: 'INVALID_FIXTURE_INPUT' } });
      fixture.handle = body.handle; persist();
      return reply(200, { data: { handle: fixture.handle } });
    }
    if (path === '/api/v1/profile/public') {
      if (request.method !== 'PATCH' || typeof body.profilePublic !== 'boolean') return reply(400, { error: { code: 'INVALID_FIXTURE_INPUT' } });
      fixture.profilePublic = body.profilePublic; persist();
      return reply(200, { data: { profilePublic: fixture.profilePublic } });
    }
    if (path === '/api/v1/projects') {
      if (request.method !== 'POST' || typeof body.id !== 'string') return reply(400, { error: { code: 'INVALID_FIXTURE_INPUT' } });
      if (fixture.proposals[body.id]) return reply(409, { error: { code: 'PROJECT_EXISTS' } });
      fixture.proposals[body.id] = body; persist();
      return reply(201, { data: { id: body.id } });
    }
    const method = path.includes('/opportunities/') ? 'PUT' : 'POST';
    if (request.method !== method || typeof body.interested !== 'boolean') return reply(400, { error: { code: 'INVALID_FIXTURE_INPUT' } });
    fixture.interests[path] = body.interested; persist();
    return reply(200, { data: { interested: body.interested } });
  };
}
