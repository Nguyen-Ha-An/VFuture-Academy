const TAB_STORAGE_KEY = 'vfuture:studio:recovery-tab';
const CLAIM_CHANNEL = 'vfuture:studio:recovery-tabs';
/** Long enough for a live tab on the same machine to answer, short enough not to delay the editor. */
const CLAIM_TIMEOUT_MS = 150;

export const RECOVERY_SIGNED_OUT_KEY = 'vfuture:auth:signed-out';

export type TabClaimChannel = {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  close(): void;
};

export type TabClaimOptions = {
  storage?: Storage;
  channel?: TabClaimChannel | null;
  timeoutMs?: number;
  newId?: () => string;
};

export type TabOwnership = {
  /** The identity this tab writes its recovery record under. Unique among live tabs. */
  tabId: string;
  /** Set when the stored identity was already held by another live tab. */
  rekeyed: boolean;
  /**
   * True when uniqueness could actually be established. False means the identity
   * is fresh-per-load, so a reload leaves its previous record behind under
   * `priorTabId` instead of writing over a possible clone's record.
   */
  durable: boolean;
  /** A previous session's identity whose record is still worth offering for restore. */
  priorTabId: string | null;
  /** Stops defending this identity. Called when the editor unmounts. */
  dispose(): void;
};

type ClaimMessage = { type: 'claim'; tabId: string; from: string } | { type: 'held'; tabId: string; to: string };

const defaultId = (): string => `tab-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;

function safeSessionStorage(): Storage | undefined {
  try { return typeof sessionStorage === 'undefined' ? undefined : sessionStorage; }
  catch { return undefined; }
}

function defaultChannel(): TabClaimChannel | null {
  try { return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(CLAIM_CHANNEL) as unknown as TabClaimChannel; }
  catch { return null; }
}

function read(storage: Storage | undefined): string | null {
  if (!storage) return null;
  try { return storage.getItem(TAB_STORAGE_KEY); } catch { return null; }
}

function write(storage: Storage | undefined, id: string): boolean {
  if (!storage) return false;
  try { storage.setItem(TAB_STORAGE_KEY, id); return true; } catch { return false; }
}

/**
 * Synchronous tab identity: `sessionStorage` is per-tab and survives a reload,
 * which is exactly the scope a recovery record needs.
 */
export function currentTabId(storage: Storage | undefined = safeSessionStorage(), newId: () => string = defaultId): string {
  const existing = read(storage);
  if (existing) return existing;
  const fresh = newId();
  write(storage, fresh);
  return fresh;
}

function messageOf(data: unknown): ClaimMessage | null {
  if (typeof data !== 'object' || data === null) return null;
  const row = data as Record<string, unknown>;
  if (row.type === 'claim' && typeof row.tabId === 'string' && typeof row.from === 'string') return row as ClaimMessage;
  if (row.type === 'held' && typeof row.tabId === 'string' && typeof row.to === 'string') return row as ClaimMessage;
  return null;
}

/**
 * Establishes an identity no other live tab is writing under.
 *
 * Duplicating a tab copies `sessionStorage`, so both copies would otherwise claim
 * one recovery record and overwrite each other's text. Each tab therefore keeps a
 * responder alive for as long as it is mounted — not just for its own handshake —
 * so a duplicate opened minutes later is still told the identity is taken and
 * re-keys itself.
 *
 * Two tabs claiming the same identity in the same instant are separated by
 * comparing their claim nonces: the lower nonce keeps the identity and the higher
 * one re-keys, so the outcome does not depend on message timing.
 *
 * Without `BroadcastChannel` uniqueness cannot be checked at all. Rather than risk
 * two clones sharing one record, the tab writes under a fresh identity and reports
 * the stored one as `priorTabId`, so the previous session's text is still offered
 * for restore and `durable: false` lets the UI say recovery is degraded.
 */
export async function claimTabId(options: TabClaimOptions = {}): Promise<TabOwnership> {
  const storage = options.storage ?? safeSessionStorage();
  const newId = options.newId ?? defaultId;
  const channel = options.channel === undefined ? defaultChannel() : options.channel;
  const stored = read(storage);
  const wanted = stored ?? currentTabId(storage, newId);

  if (!channel) {
    const fresh = newId();
    const persisted = write(storage, fresh);
    return {
      tabId: fresh,
      rekeyed: stored !== null,
      durable: false,
      priorTabId: stored,
      dispose: () => { if (!persisted) return; },
    };
  }

  let owned = wanted;
  let phase: 'claiming' | 'owner' = 'claiming';
  const nonce = newId();
  let taken = false;

  const listener = (event: { data: unknown }) => {
    const message = messageOf(event.data);
    if (!message) return;
    if (message.type === 'claim') {
      if (message.tabId !== owned || message.from === nonce) return;
      // While still claiming, the lower nonce wins so both tabs reach the same
      // conclusion regardless of which message arrives first.
      if (phase === 'claiming' && nonce > message.from) { taken = true; return; }
      channel.postMessage({ type: 'held', tabId: owned, to: message.from });
      return;
    }
    if (message.tabId === owned && message.to === nonce) taken = true;
  };
  channel.addEventListener('message', listener);

  channel.postMessage({ type: 'claim', tabId: wanted, from: nonce });
  await new Promise(resolve => setTimeout(resolve, options.timeoutMs ?? CLAIM_TIMEOUT_MS));

  const rekeyed = taken;
  if (rekeyed) {
    owned = newId();
    write(storage, owned);
  }
  // From here the responder defends the identity actually in use, for as long as
  // this editor stays mounted.
  phase = 'owner';

  return {
    tabId: owned,
    rekeyed,
    durable: true,
    priorTabId: rekeyed ? wanted : null,
    dispose: () => {
      channel.removeEventListener('message', listener);
      try { channel.close(); } catch { /* Already closed. */ }
    },
  };
}
