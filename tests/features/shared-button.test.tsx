// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { createRef } from 'react';

import { Button } from '@/components/ui/classic';

afterEach(() => {
  cleanup();
});

describe('shared Button', () => {
  it('lets caller background, text, and horizontal padding utilities replace defaults while preserving the variant', () => {
    render(<Button className="bg-background text-foreground px-2">Continue</Button>);

    const button = screen.getByRole('button', { name: 'Continue' });

    expect(button).toHaveClass('bg-background', 'text-foreground', 'px-2', 'rounded-md');
    expect(button).not.toHaveClass('bg-primary', 'text-primary-foreground', 'px-4');
  });

  it('forwards native props and refs without leaking component-only props', () => {
    const ref = createRef<HTMLButtonElement>();

    render(<Button ref={ref} type="submit" disabled data-testid="shared-button">Save</Button>);

    const button = screen.getByTestId('shared-button');

    expect(button).toHaveAttribute('type', 'submit');
    expect(button).toBeDisabled();
    expect(ref.current).toBe(button);
    expect(button).not.toHaveAttribute('variant');
  });
});
