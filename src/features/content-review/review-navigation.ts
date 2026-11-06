/** Return destinations are restricted to the review queue, including its scope and filters. */
export function reviewQueueReturnHref(value: string | null | undefined): string {
  if (!value || /[\\\u0000-\u0020]/.test(value)) return '/studio/reviews';
  try {
    const url = new URL(value, 'https://academy.invalid');
    if (!value.startsWith('/') || url.origin !== 'https://academy.invalid' || url.pathname !== '/studio/reviews') return '/studio/reviews';
    return `${url.pathname}${url.search}`;
  } catch {
    return '/studio/reviews';
  }
}

const scrollKey = (href: string) => `academy:review-queue:${reviewQueueReturnHref(href)}`;

export function rememberReviewQueueScroll(href: string) {
  try { sessionStorage.setItem(scrollKey(href), String(window.scrollY)); } catch { /* Storage can be unavailable. */ }
}

export function restoreReviewQueueScroll(href: string) {
  try {
    const value = sessionStorage.getItem(scrollKey(href));
    const scroll = value === null ? NaN : Number(value);
    if (Number.isFinite(scroll) && scroll >= 0) window.scrollTo({ top: scroll, behavior: 'instant' });
  } catch { /* The queue remains usable without scroll restoration. */ }
}
