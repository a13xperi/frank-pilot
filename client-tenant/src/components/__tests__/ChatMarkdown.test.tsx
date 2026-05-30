// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatMarkdown } from '../ChatMarkdown';

describe('ChatMarkdown', () => {
  it('renders bold, emphasis, and inline code (not literal markers)', () => {
    const { container } = render(
      <ChatMarkdown text="The fee is **$35.95**, it is *non-refundable*, paid via `Stripe`." />
    );
    expect(container.querySelector('strong')?.textContent).toBe('$35.95');
    expect(container.querySelector('em')?.textContent).toBe('non-refundable');
    expect(container.querySelector('code')?.textContent).toBe('Stripe');
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it('renders bulleted lists', () => {
    const { container } = render(
      <ChatMarkdown text={'Bring:\n- Photo ID\n- Proof of income\n- SSN card'} />
    );
    const items = container.querySelectorAll('li');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toBe('Photo ID');
  });

  it('renders headings as text, dropping the ## marker', () => {
    render(<ChatMarkdown text={'## Next steps\nFinish your application.'} />);
    expect(screen.getByText('Next steps')).toBeInTheDocument();
    expect(screen.queryByText(/##/)).not.toBeInTheDocument();
  });

  it('renders safe links with target=_blank and rel=noopener', () => {
    const { container } = render(
      <ChatMarkdown text="See the [discover map](https://frank-pilot-tenant.vercel.app/discover)." />
    );
    const a = container.querySelector('a');
    expect(a?.getAttribute('href')).toBe('https://frank-pilot-tenant.vercel.app/discover');
    expect(a?.getAttribute('target')).toBe('_blank');
    expect(a?.getAttribute('rel')).toContain('noopener');
  });

  // --- security: model output is untrusted ---

  it('strips javascript: URLs — anchor text survives but href is inert', () => {
    const { container } = render(<ChatMarkdown text="[click me](javascript:alert)" />);
    expect(screen.getByText('click me')).toBeInTheDocument();
    expect(container.querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/^javascript:/i);
  });

  it('does not emit raw HTML — <script> and <img onerror> never become elements', () => {
    const { container } = render(
      <ChatMarkdown text={'Hi <script>alert(1)</script> and <img src=x onerror="alert(2)">'} />
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });
});
