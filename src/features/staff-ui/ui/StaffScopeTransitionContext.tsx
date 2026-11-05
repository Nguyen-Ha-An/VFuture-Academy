'use client';
import { createContext, useContext } from 'react';
import type { ScopeChange } from '@/features/workspace/useScopeChange';

export type StaffScopeTransition = {
  state: ScopeChange;
  queued: boolean;
  compact: boolean;
  request: (scope: string, closeOverlay?: () => void) => void;
};
export const StaffScopeTransitionContext = createContext<StaffScopeTransition | null>(null);
export function useStaffScopeTransition() { return useContext(StaffScopeTransitionContext); }
