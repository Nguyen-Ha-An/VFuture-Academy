export type RouteQueryValue = string | number | boolean | null | undefined;
export type RouteQuery =
  | URLSearchParams
  | Readonly<Record<string, RouteQueryValue | readonly RouteQueryValue[]>>;

function appendQueryValue(search: URLSearchParams, key: string, value: RouteQueryValue): void {
  if (value === null || value === undefined) return;
  search.append(key, String(value));
}

/** Builds a path-only URL while retaining repeated query values in their original order. */
export function withQuery(pathname: string, query?: RouteQuery): string {
  if (!query) return pathname;
  const search = new URLSearchParams();

  if (query instanceof URLSearchParams) {
    query.forEach((value, key) => search.append(key, value));
  } else {
    for (const [key, value] of Object.entries(query)) {
      if (Array.isArray(value)) value.forEach((item) => appendQueryValue(search, key, item));
      else appendQueryValue(search, key, value as RouteQueryValue);
    }
  }

  const serialized = search.toString();
  return serialized ? `${pathname}?${serialized}` : pathname;
}

function segment(value: string | number): string {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/\./g, '%2E');
}

const path = (pathname: string) => (query?: RouteQuery) => withQuery(pathname, query);

/**
 * Assessment & grading workspace (`Khảo thí & đánh giá`). Canonical destinations
 * for assessments, grading queues/workbenches and learning reports.
 */
const gradingRoutes = {
  dashboard: path('/grading'),
  assessments: path('/grading/assessments'),
  queue: path('/grading/queue'),
  assignment: (submissionId: string, query?: RouteQuery) => withQuery(`/grading/assignments/${segment(submissionId)}`, query),
  exam: (attemptId: string, query?: RouteQuery) => withQuery(`/grading/exams/${segment(attemptId)}`, query),
  reports: path('/grading/reports'),
} as const;

export const routes = {
  public: {
    home: path('/'),
    academy: path('/academy'),
    courses: path('/courses'),
    course: (courseId: string, query?: RouteQuery) => withQuery(`/courses/${segment(courseId)}`, query),
    resources: path('/resources'),
    resource: (resourceId: string, query?: RouteQuery) => withQuery(`/resources/${segment(resourceId)}`, query),
    opportunities: path('/opportunities'),
    opportunity: (opportunityId: string, query?: RouteQuery) => withQuery(`/opportunities/${segment(opportunityId)}`, query),
    projects: path('/projects'),
    project: (projectId: string, query?: RouteQuery) => withQuery(`/projects/${segment(projectId)}`, query),
    profile: (handle: string, query?: RouteQuery) => withQuery(`/u/${segment(handle)}`, query),
    verify: (code: string, query?: RouteQuery) => withQuery(`/verify/${segment(code)}`, query),
  },
  learner: {
    dashboard: path('/app'),
    courses: path('/app/courses'),
    course: (courseId: string, query?: RouteQuery) => withQuery(`/app/courses/${segment(courseId)}`, query),
    courseItem: (courseId: string, itemId: string, query?: RouteQuery) =>
      withQuery(`/app/courses/${segment(courseId)}/items/${segment(itemId)}`, query),
    explore: path('/app/explore'),
    resources: path('/app/resources'),
    resource: (resourceId: string, query?: RouteQuery) => withQuery(`/app/resources/${segment(resourceId)}`, query),
    opportunities: path('/app/opportunities'),
    opportunity: (opportunityId: string, query?: RouteQuery) => withQuery(`/app/opportunities/${segment(opportunityId)}`, query),
    projects: path('/app/projects'),
    newProject: path('/app/projects/new'),
    project: (projectId: string, query?: RouteQuery) => withQuery(`/app/projects/${segment(projectId)}`, query),
    profile: path('/app/profile'),
    leaderboard: path('/app/leaderboard'),
  },
  grading: gradingRoutes,
  studio: {
    dashboard: path('/studio'),
    /** @deprecated Use routes.grading.reports(). */
    analytics: gradingRoutes.reports,
    /** @deprecated Use routes.grading.assessments(). */
    assessments: gradingRoutes.assessments,
    audit: path('/studio/audit'),
    bank: path('/studio/bank'),
    bankItem: (questionId: string, query?: RouteQuery) => withQuery(`/studio/bank/${segment(questionId)}`, query),
    branches: path('/studio/branches'),
    courses: path('/studio/courses'),
    course: (courseId: string, query?: RouteQuery) => withQuery(`/studio/courses/${segment(courseId)}`, query),
    exams: path('/studio/exams'),
    /** @deprecated Use routes.grading.queue(). */
    grading: gradingRoutes.queue,
    /** @deprecated Use routes.grading.assignment(). */
    gradingAssignment: gradingRoutes.assignment,
    /** @deprecated Use routes.grading.exam(). */
    gradingExam: gradingRoutes.exam,
    library: path('/studio/library'),
    mcp: path('/studio/mcp'),
    media: path('/studio/media'),
    opportunities: path('/studio/opportunities'),
    opportunity: (opportunityId: string, query?: RouteQuery) => withQuery(`/studio/opportunities/${segment(opportunityId)}`, query),
    projects: path('/studio/projects'),
    project: (projectId: string, query?: RouteQuery) => withQuery(`/studio/projects/${segment(projectId)}`, query),
    resources: path('/studio/resources'),
    reviews: path('/studio/reviews'),
    resource: (resourceId: string, query?: RouteQuery) => withQuery(`/studio/resources/${segment(resourceId)}`, query),
    submissions: path('/studio/submissions'),
    users: path('/studio/users'),
  },
  admin: {
    dashboard: path('/admin'),
    cms: path('/admin/cms'),
    reviews: path('/admin/reviews'),
    roles: path('/admin/roles'),
    mcp: path('/admin/mcp'),
    user: (userId: string, query?: RouteQuery) => withQuery(`/admin/users/${segment(userId)}`, query),
    branch: (branchId: string, query?: RouteQuery) => withQuery(`/admin/branches/${segment(branchId)}`, query),
    analytics: path('/admin/analytics'),
    audit: path('/admin/audit'),
    bank: path('/admin/bank'),
    bankItem: (questionId: string, query?: RouteQuery) => withQuery(`/admin/bank/${segment(questionId)}`, query),
    branches: path('/admin/branches'),
    exams: path('/admin/exams'),
    opportunities: path('/admin/opportunities'),
    opportunity: (opportunityId: string, query?: RouteQuery) => withQuery(`/admin/opportunities/${segment(opportunityId)}`, query),
    projects: path('/admin/projects'),
    project: (projectId: string, query?: RouteQuery) => withQuery(`/admin/projects/${segment(projectId)}`, query),
    resources: path('/admin/resources'),
    resource: (resourceId: string, query?: RouteQuery) => withQuery(`/admin/resources/${segment(resourceId)}`, query),
    submissions: path('/admin/submissions'),
    users: path('/admin/users'),
    enrollmentMigration: path('/admin/enrollment-migration'),
  },
  auth: {
    login: path('/login'),
    signup: path('/signup'),
    welcome: path('/welcome'),
    callback: path('/auth/callback'),
    signout: path('/auth/signout'),
    forgotPassword: path('/forgot-password'),
    resetPassword: path('/reset-password'),
    recovery: path('/auth/recovery'),
  },
  legacy: {
    home: path('/home'),
    courses: path('/learn'),
    course: (courseId: string, query?: RouteQuery) => withQuery(`/learn/${segment(courseId)}`, query),
    courseItem: (courseId: string, itemId: string, query?: RouteQuery) =>
      withQuery(`/learn/${segment(courseId)}/items/${segment(itemId)}`, query),
    projects: path('/build'),
    project: (projectId: string, query?: RouteQuery) => withQuery(`/build/${segment(projectId)}`, query),
    resources: path('/resources'),
    resource: (resourceId: string, query?: RouteQuery) => withQuery(`/resources/${segment(resourceId)}`, query),
    opportunities: path('/opportunities'),
    opportunity: (opportunityId: string, query?: RouteQuery) => withQuery(`/opportunities/${segment(opportunityId)}`, query),
    profile: path('/profile'),
    leaderboard: path('/leaderboard'),
  },
} as const;
