import 'server-only';

/** Owner-controlled release gate. Drafts never enter the sitemap or become indexable by default. */
export function policyPublication(source: Record<string, string | undefined> = process.env) {
  const date = source.PUBLIC_POLICIES_EFFECTIVE_DATE?.trim();
  const validDate = Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date);
  const approved = source.PUBLIC_POLICIES_APPROVED === 'true' && validDate;
  return { approved, effectiveDate: approved ? date! : null };
}
