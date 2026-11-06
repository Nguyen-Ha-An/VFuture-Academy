// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
const navigate=vi.hoisted(()=>vi.fn());
vi.mock('next-intl',()=>({useLocale:()=> 'en',useTranslations:()=> (key:string)=>key}));
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams('next=%2Fapp%2Fcourses%2Ftest')}));
vi.mock('@/lib/post-auth-navigation',()=>({navigateAfterAuth:navigate}));
import { AzureAuthPanel } from '@/components/AzureAuthPanel';
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(window,'open').mockReturnValue({closed:false,close:vi.fn(),focus:vi.fn()} as unknown as Window);});
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('inline Azure identity UI',()=>{
  it('shows the normal credentials form and signup link, with popups only for social login',()=>{
    render(<AzureAuthPanel mode="login"/>);
    expect(screen.getByLabelText('email')).toBeInTheDocument();expect(screen.getByLabelText('password')).toBeInTheDocument();
    const form=screen.getByRole('button',{name:'signIn'}).closest('form')!;
    expect(form.method).toBe('post');
    expect(new URL(form.action).pathname).toBe('/api/v1/public/auth/native');
    expect(screen.getByRole('link',{name:'openSignup'})).toHaveAttribute('href',expect.stringContaining('/signup'));
    expect(screen.queryByRole('button',{name:/email and password.*backup/i})).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'continueGoogle'}));
    const opened=new URL(String(vi.mocked(window.open).mock.calls[0][0]));
    expect(opened.searchParams.get('provider')).toBe('google');expect(opened.searchParams.get('popup')).toBe('1');
  });
  it('submits password credentials on the same UI without opening a window',async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({step:'complete',next:'/welcome?next=%2Fapp'}));vi.stubGlobal('fetch',fetcher);
    render(<AzureAuthPanel mode="login"/>);
    fireEvent.change(screen.getByLabelText('email'),{target:{value:'learner@example.com'}});
    fireEvent.change(screen.getByLabelText('password'),{target:{value:'Password1!'}});
    fireEvent.click(screen.getByRole('button',{name:'signIn'}));
    await waitFor(()=>expect(navigate).toHaveBeenCalledWith('/welcome?next=%2Fapp'));
    expect(window.open).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/public/auth/native');
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({mode:'login',email:'learner@example.com',password:'Password1!'});
  });
  it('keeps signup email verification on the page and offers a normal login link',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({step:'code',flowId:'a'.repeat(43),attemptId:'b'.repeat(43),codeLength:8})));
    render(<AzureAuthPanel mode="signup"/>);
    expect(screen.getByRole('link',{name:'openLogin'})).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'),{target:{value:'Learner Name'}});
    fireEvent.change(screen.getByLabelText('email'),{target:{value:'learner@example.com'}});
    fireEvent.change(screen.getByLabelText('password'),{target:{value:'Password1!'}});
    fireEvent.change(screen.getByLabelText('confirmPassword'),{target:{value:'Password1!'}});
    fireEvent.click(screen.getByRole('button',{name:'createAccount'}));
    await screen.findByLabelText('Verification code');expect(window.open).not.toHaveBeenCalled();
  });
  it('starts recovery inline rather than opening the Microsoft password page',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({step:'code',flowId:'a'.repeat(43),attemptId:'b'.repeat(43),codeLength:8})));
    render(<AzureAuthPanel mode="recovery"/>);
    fireEvent.change(screen.getByLabelText('email'),{target:{value:'learner@example.com'}});
    fireEvent.click(screen.getByRole('button',{name:'Send verification code'}));
    await screen.findByLabelText('Verification code');expect(window.open).not.toHaveBeenCalled();
  });
  it('clears an abandoned social-window wait when the user switches to password login',async()=>{
    vi.mocked(window.open).mockReturnValue({closed:true,close:vi.fn(),focus:vi.fn()} as unknown as Window);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({error:'invalid_credentials'},{status:400})));
    render(<AzureAuthPanel mode="login"/>);
    fireEvent.click(screen.getByRole('button',{name:'continueGoogle'}));
    await screen.findByText(/Waiting for sign-in to finish/);
    fireEvent.change(screen.getByLabelText('email'),{target:{value:'learner@example.com'}});
    fireEvent.change(screen.getByLabelText('password'),{target:{value:'Password1!'}});
    fireEvent.click(screen.getByRole('button',{name:'signIn'}));
    await screen.findByText('invalidCredentials');
    expect(screen.queryByText(/Waiting for sign-in to finish/)).not.toBeInTheDocument();
  });
});
