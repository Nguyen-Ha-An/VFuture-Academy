import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RichText } from '@/content-engine/render/RichText';

describe('RichText', () => {
  it('renders runs with annotations and links', () => {
    render(<RichText runs={[{ text: 'Hello ' }, { text: 'bold', annotations: { bold: true, color: '#ed1c24' } }, { text: ' x', annotations: { sup: true } }, { text: 'site', annotations: { link: { href: 'https://vfuturelabs.org', target: '_blank' } } }]} />);
    const b = screen.getByText('bold');
    expect(b.tagName).toBe('STRONG');
    expect(b).toHaveStyle({ color: '#ed1c24' });
    expect(screen.getByText('x').tagName).toBe('SUP');
    const a = screen.getByRole('link', { name: 'site' });
    expect(a).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('renders blank runs through renderBlank, or a placeholder', () => {
    const { rerender } = render(<RichText runs={[{ text: 'A ' }, { blank: 'b1' }]} renderBlank={(id) => <input aria-label={`blank ${id}`} />} />);
    expect(screen.getByLabelText('blank b1')).toBeInTheDocument();
    rerender(<RichText runs={[{ blank: 'b1' }]} />);
    expect(screen.getByText('____')).toBeInTheDocument();
  });
  it('preserves newlines inside a run', () => {
    render(<RichText runs={[{ text: 'line1\nline2' }]} />);
    expect(screen.getByText(/line1/).className).toContain('whitespace-pre-wrap');
  });
  it('composes code inside bold instead of dropping it', () => {
    render(<RichText runs={[{ text: 'x', annotations: { code: true, bold: true } }]} />);
    const el = screen.getByText('x');
    expect(el.tagName).toBe('CODE');
    expect(el.parentElement?.tagName).toBe('STRONG');
  });
  it('keeps colour on sub/sup runs', () => {
    render(<RichText runs={[{ text: 'y', annotations: { sup: true, color: '#ed1c24' } }]} />);
    expect(screen.getByText('y')).toHaveStyle({ color: '#ed1c24' });
  });
  it('nests italic, underline and strike together', () => {
    render(<RichText runs={[{ text: 'z', annotations: { italic: true, underline: true, strike: true } }]} />);
    const el = screen.getByText('z');
    expect(el.closest('s')).not.toBeNull();
    expect(el.closest('u')).not.toBeNull();
    expect(el.closest('em')).not.toBeNull();
  });
});
