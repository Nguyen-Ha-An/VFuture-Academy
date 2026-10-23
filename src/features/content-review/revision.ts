/** API timestamps and PostgreSQL text differ in spelling, but not in microsecond precision. */
export function sameContentRevision(
  type: string,
  left: string | null,
  right: string | null,
): boolean {
  if (!left || !right) return false;
  if (left === right) return true;
  if (!["course", "resource", "opportunity", "project"].includes(type))
    return false;
  const timestamp =
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}(?::?\d{2})?)$/;
  const a = left.match(timestamp),
    b = right.match(timestamp);
  if (!a || !b) return false;
  const normalize = (value: string) =>
    value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00");
  const timeA = Date.parse(normalize(left)),
    timeB = Date.parse(normalize(right));
  const precision = (match: RegExpMatchArray) =>
    (match[1] ?? "").padEnd(3, "0").slice(3).replace(/0+$/, "");
  return (
    Number.isFinite(timeA) && timeA === timeB && precision(a) === precision(b)
  );
}

/** Spell a database timestamp as ISO without dropping PostgreSQL's fractional precision. */
export function isoRevisionTimestamp(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value))
    return value;
  const match = value.match(
    /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.(\d+))?(?:Z|[+-]\d{2}(?::?\d{2})?)$/,
  );
  if (!match) throw new Error("Invalid revision timestamp");
  const parsed = new Date(
    value.replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"),
  );
  if (!Number.isFinite(parsed.getTime()))
    throw new Error("Invalid revision timestamp");
  // Date handles the zone conversion only; retain the source fraction instead of its rounded milliseconds.
  return parsed
    .toISOString()
    .replace(/\.\d{3}Z$/, `.${(match[1] ?? "").padEnd(3, "0")}Z`);
}
