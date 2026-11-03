// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('next=%2Fapp%2Fcourses%2Ftest') }));
import { AzureAuthPanel } from '@/components/AzureAuthPanel';
beforeEach(()=>{vi.spyOn(window,'open').mockReturnValue({closed:false,close:vi.fn(),focus:vi.fn()} as unknown as Window);});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
describe('hosted Azure identity UI', () => {
  it('offers hosted password and configured social entry points without collecting a password locally', () => {
    render(<AzureAuthPanel mode="login" />);
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getAllByRole('button')[0]).toHaveTextContent('continueGoogle');
    expect(screen.getByRole('button', { name: /Microsoft.*internal staff/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /email and password.*backup/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'continueGoogle'}));
    const opened=new URL(String(vi.mocked(window.open).mock.calls[0][0]));
    expect(opened.searchParams.get('provider')).toBe('google');expect(opened.searchParams.get('next')).toBe('/app/courses/test');expect(opened.searchParams.get('popup')).toBe('1');
    expect(screen.getByRole('button',{name:'continueGoogle'})).toBeDisabled();expect(screen.getByRole('status')).toHaveTextContent('popup');
  });
  it('directs recovery to the hosted self-service reset flow with explicit instructions', () => {
    render(<AzureAuthPanel mode="recovery" />);
    expect(screen.getByText(/Forgot your password/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:/continue to password recovery/i}));
    expect(new URL(String(vi.mocked(window.open).mock.calls[0][0])).searchParams.get('mode')).toBe('recovery');
  });
});
