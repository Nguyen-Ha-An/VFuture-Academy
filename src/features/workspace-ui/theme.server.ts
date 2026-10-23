import 'server-only';
import { cookies } from 'next/headers';
import { parseWorkspaceTheme, WORKSPACE_THEME_COOKIE, type WorkspaceTheme } from './theme';

export async function readWorkspaceTheme(): Promise<WorkspaceTheme> {
  return parseWorkspaceTheme((await cookies()).get(WORKSPACE_THEME_COOKIE)?.value);
}
