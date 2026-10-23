import { createTranslator } from 'next-intl';
import en from '../../../../src/messages/en.json';
import vi from '../../../../src/messages/vi.json';
import { withBenchMessages } from '../../../../src/messages/bench';
const fixtureLocale = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'vi';
export async function getLocale() { return fixtureLocale; }
export async function getTranslations(namespace: string) { const locale = await getLocale(); return createTranslator({locale, messages: withBenchMessages(locale === 'en' ? en : vi, locale), namespace: namespace as never}); }
