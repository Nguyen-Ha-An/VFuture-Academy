import React from 'react';
import { createRoot } from 'react-dom/client';
import { NextIntlClientProvider } from 'next-intl';
import { AppShell } from '@/components/AppShell';
import { ItemPlayer } from '@/features/learner/ui/ItemPlayer';
import { FocusOutline } from '@/features/learner/ui/FocusOutline';
import { LearnerNavigationLink } from '@/features/learner/ui/LearnerNavigationLink';
import type { LearnerItem } from '@/content-engine/compile';
import { usePathname, useSearchParams } from './next-navigation';
import { BLOCK, COURSE, ITEM, START, FIRST_DESTINATION, SECOND_DESTINATION } from './runtime-fixture-data';
import en from '../../../../src/messages/en.json';
import vi from '../../../../src/messages/vi.json';
import { withBenchMessages } from '@/messages/bench';
import '@/app/globals.css';

// Entry setup only. Destination routing/focus is never supplied by this fixture.
const locale = new URLSearchParams(location.search).get('lang') === 'vi' ? 'vi' : 'en';
document.documentElement.lang = locale;
history.replaceState({}, '', `${START}?lang=${locale}`);
const item: LearnerItem = {
 kind: 'lesson', id: ITEM, title: locale === 'vi' ? 'Bài học phản hồi' : 'Response lesson',
 blocks: [{ id: BLOCK, type: 'reflection', required: true, minChars: 3, maxChars: 2000,
  prompt: { blocks: [{ type: 'paragraph', content: [{ text: locale === 'vi' ? 'Viết phản hồi của bạn' : 'Write your response' }] }] },
 }],
};
const modules = [{ id: 'runtime-module', title: 'Runtime fixture', items: [
 { id: ITEM, title: 'Current response', status: 'not_started' },
 { id: 'destination-a', title: 'Destination A', status: 'not_started' },
 { id: 'destination-b', title: 'Destination B', status: 'not_started' },
]}];

function RuntimeHarness() {
 const pathname = usePathname();
 const query = useSearchParams();
 const atSource = pathname === START;
 return <NextIntlClientProvider locale={locale} messages={withBenchMessages(locale === 'vi' ? vi : en, locale)} timeZone="UTC">
  <AppShell userName="Runtime fixture learner" initials="FL">
   {atSource ? <>
    <h1 className="text-3xl font-semibold">{locale === 'vi' ? 'Kiểm tra lưu tiến độ' : 'Progress save acceptance'}</h1>
    <div className="mt-5"><FocusOutline courseId={COURSE} itemId={ITEM} modules={modules} /></div>
    <nav aria-label="Runtime test destinations" className="my-5 flex flex-wrap gap-4">
     <LearnerNavigationLink id="runtime-first" href={FIRST_DESTINATION}>First guarded destination</LearnerNavigationLink>
     <LearnerNavigationLink id="runtime-second" href={SECOND_DESTINATION}>Second guarded destination</LearnerNavigationLink>
     <a id="runtime-native-exit" href="/runtime.html?native-exit=1">Native document exit</a>
    </nav>
    <ItemPlayer courseId={COURSE} itemId={ITEM} locale={locale} item={item} activityState={{}} completionMode="activities" completed={false} attemptsUsed={0} />
   </> : <>
    <h1>Destination fixture</h1>
    <p id="response" className="mt-5">The original source player has unmounted.</p>
    <output id="runtime-destination">{pathname}{query.toString() ? `?${query}` : ''}{location.hash}</output>
   </>}
  </AppShell>
 </NextIntlClientProvider>;
}
createRoot(document.getElementById('runtime-root')!).render(<RuntimeHarness />);
