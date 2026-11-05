import { createTranslator } from 'next-intl';
import en from '@/messages/en.json';
import vi from '@/messages/vi.json';
import { withBenchMessages } from '@/messages/bench';
import { learnerReviewParam } from './review-state';

export const locale = () => { const requested = learnerReviewParam('lang'); return requested === 'vi' || requested === 'en' ? requested : sessionStorage.getItem('fixture-locale') === 'vi' ? 'vi' : 'en'; };
export const messages = () => withBenchMessages(locale() === 'vi' ? vi : en, locale());
export async function getLocale() { return locale(); }
export async function getTranslations(namespace: string) {
  return createTranslator({ locale: locale(), messages: messages(), namespace: namespace as never });
}
