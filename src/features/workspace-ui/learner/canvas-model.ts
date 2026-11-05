/** Presentation models only. The server adapters retain backend authorization and score release rules. */
export type CanvasTask = { id: string; courseId?: string; title: string; courseTitle: string; href: string; dueAt: string | null; status: string; kind: 'assignment' | 'exam' | 'lesson'; late?: boolean | null };
export type CanvasResult = { id: string; courseId?: string; title: string; courseTitle: string; href: string; score: number | null; maxScore: number | null; status: string; recordedAt: string | null };
export type CanvasAnnouncement = { id: string; courseId?: string; title: string; body: string; publishedAt: string; courseTitle?: string };
export type CanvasEvent = { id: string; title: string; courseTitle: string; href: string; at: string; kind: string };
