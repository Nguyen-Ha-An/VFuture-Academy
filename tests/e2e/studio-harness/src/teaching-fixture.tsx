import { useEffect, useState } from 'react';
import { AnnouncementsWorkspace } from '../../../../src/features/instructor-grading/AnnouncementsWorkspace';
import { ScheduleWorkspace } from '../../../../src/features/instructor-grading/ScheduleWorkspace';

type FixtureAnnouncement = { id: string; title: string; body: string; status: 'draft' | 'published' | 'archived'; revision: number };
export function TeachingFixture({ kind, locale }: { kind: 'announcements' | 'schedule'; locale: 'vi' | 'en' }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const original = window.fetch;
    const scenario = new URLSearchParams(location.search).get('fixture');
    let announcement: FixtureAnnouncement | null = scenario === 'seeded' || scenario === 'stale' ? { id: 'announcement', title: 'Existing draft', body: 'A saved announcement for review.', status: 'draft', revision: 1 } : null;
    let dueAt: string | null = scenario === 'busy' ? '2026-11-05T00:30:00.000Z' : null;
    window.fetch = async (input, init) => {
      const url = String(input);
      const body = (data: unknown, status = 200) => new Response(JSON.stringify(status === 200 ? { data } : { error: { code: 'STALE_ANNOUNCEMENT', message: 'Announcement changed' } }), { status, headers: { 'content-type': 'application/json' } });
      if (url.includes('/teaching/options')) return body({ courses: [{ id: 'course', title: locale === 'vi' ? 'Vật lý' : 'Physics' }], versions: [{ courseId: 'course', courseTitle: locale === 'vi' ? 'Vật lý' : 'Physics', courseVersionId: 'version', version: 2 }] });
      if (url.includes('/teaching/announcements')) {
        if (init?.method === 'POST' && url.endsWith('/announcements')) {
          const draft = JSON.parse(String(init.body));
          announcement = { id: 'announcement', title: draft.title, body: draft.body, status: 'draft', revision: 1 };
          return body({ announcement });
        }
        if (init?.method === 'PATCH' || init?.method === 'DELETE' || url.endsWith('/publish') || url.endsWith('/archive')) {
          const update = JSON.parse(String(init?.body));
          if (!announcement || scenario === 'stale' || update.expectedRevision !== announcement.revision) return body(null, 409);
          if (init?.method === 'DELETE') { announcement = null; return body({ deleted: true }); }
          if (init?.method === 'PATCH') { announcement.title = update.title ?? announcement.title; announcement.body = update.body ?? announcement.body; }
          if (url.endsWith('/publish')) announcement.status = 'published';
          if (url.endsWith('/archive')) announcement.status = 'archived';
          announcement.revision += 1;
          return body({ announcement });
        }
        return body({ announcements: announcement ? [announcement] : [] });
      }
      if (url.includes('/teaching/schedules')) {
        if (init?.method === 'PUT') { dueAt = JSON.parse(String(init.body)).dueAt; return body({}); }
        const assignments = [{ itemId: 'exercise', blockId: null, title: locale === 'vi' ? 'Bài tập' : 'Exercise' }, ...(scenario === 'busy' ? [{ itemId: 'second', blockId: null, title: locale === 'vi' ? 'Dự án nhóm và phân tích dữ liệu' : 'Group project and data analysis' }] : [])];
        const schedules = [...(dueAt ? [{ itemId: 'exercise', blockId: null, dueAt }] : []), ...(scenario === 'busy' ? [{ itemId: 'second', blockId: null, dueAt: '2026-11-12T07:00:00.000Z' }] : [])];
        return body({ assignments, schedules });
      }
      return original(input, init);
    };
    setReady(true);
    return () => { window.fetch = original; };
  }, [locale]);
  if (!ready) return null;
  const branches = [{ id: 'school', name: locale === 'vi' ? 'Trường VFuture' : 'VFuture school' }];
  return kind === 'announcements' ? <AnnouncementsWorkspace branches={branches} locale={locale} /> : <ScheduleWorkspace branches={branches} locale={locale} />;
}
