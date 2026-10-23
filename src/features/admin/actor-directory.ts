import "server-only";
import { supabaseService } from "@/lib/supabase/server";

/** A person as staff screens show them next to an action: name, optional photo, initials fallback. */
export type ActorDisplay = {
  name: string;
  avatarUrl: string | null;
  initials: string;
};

type ProfileQueryResult = { data: unknown; error: unknown };
type ProfileDatabase = {
  from(table: "profiles"): {
    select(columns: string): {
      in(column: string, values: string[]): PromiseLike<ProfileQueryResult>;
    };
  };
};

/** PostgREST keeps `in.(…)` filters well under URL limits at this size. */
export const ACTOR_BATCH_SIZE = 100;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HAS_LETTER = /[\p{L}\p{N}]/u;

function firstLetter(word: string): string {
  return Array.from(word).find((char) => HAS_LETTER.test(char)) ?? "";
}

/**
 * Up to two letters, following the staff user-menu convention: Vietnamese names put the
 * given name last ("Nguyễn Minh Anh" → "MA"), so a multi-word name uses its last two words.
 */
export function actorInitials(name: string): string {
  const words = name
    .normalize("NFC")
    .trim()
    .split(/[\s._+-]+/u)
    .filter((word) => HAS_LETTER.test(word));
  const picked = words.length > 1 ? words.slice(-2) : words;
  return picked.map(firstLetter).join("").toLocaleUpperCase("vi");
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Deduplicated, lower-cased UUIDs; null, empty and malformed ids are dropped. */
export function normalizeActorIds(
  ids: Iterable<string | null | undefined>,
): string[] {
  const unique = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (UUID.test(trimmed)) unique.add(trimmed.toLowerCase());
  }
  return [...unique];
}

function toDisplay(row: unknown): [string, ActorDisplay] | null {
  if (typeof row !== "object" || row === null) return null;
  const profile = row as Record<string, unknown>;
  const id = text(profile.id);
  if (!id) return null;
  const name = text(profile.display_name) ?? text(profile.handle);
  // No usable name: leave the id out so the caller shows its own "System"/ID fallback.
  if (!name) return null;
  return [
    id.toLowerCase(),
    {
      name,
      avatarUrl: text(profile.avatar_url),
      initials: actorInitials(name),
    },
  ];
}

/**
 * Display names for audit actors, content owners and submitters, keyed by lower-cased user id.
 * Never throws: a failed batch simply leaves its ids out, and callers render "System" or the id.
 */
export async function actorDisplayNames(
  ids: Iterable<string | null | undefined>,
  database?: ProfileDatabase,
): Promise<Map<string, ActorDisplay>> {
  const actors = new Map<string, ActorDisplay>();
  const wanted = normalizeActorIds(ids);
  if (wanted.length === 0) return actors;
  let client: ProfileDatabase;
  try {
    client = database ?? (supabaseService() as unknown as ProfileDatabase);
  } catch {
    return actors;
  }
  const batches: string[][] = [];
  for (let index = 0; index < wanted.length; index += ACTOR_BATCH_SIZE)
    batches.push(wanted.slice(index, index + ACTOR_BATCH_SIZE));
  const results = await Promise.all(
    batches.map(async (batch) => {
      try {
        const { data, error } = await client
          .from("profiles")
          .select("id, handle, display_name, avatar_url")
          .in("id", batch);
        return error || !Array.isArray(data) ? [] : data;
      } catch {
        return [];
      }
    }),
  );
  for (const row of results.flat()) {
    const entry = toDisplay(row);
    if (entry) actors.set(entry[0], entry[1]);
  }
  return actors;
}
