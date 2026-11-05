'use client';

import { createContext, useContext } from 'react';
import './workspace-surface-context.css';

/** React portals retain their owning workspace's theme; public/auth consumers stay unchanged. */
export type WorkspaceSurfaceTheme = 'light' | 'dark' | null;
export const WorkspaceSurfaceContext = createContext<WorkspaceSurfaceTheme>(null);
export function useWorkspaceSurfaceTheme() { return useContext(WorkspaceSurfaceContext); }
