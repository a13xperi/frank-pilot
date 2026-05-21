import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PayHeader, type PayHeaderStep } from '../PayHeader';

const STEPS: PayHeaderStep[] = ['review', 'household', 'payment', 'details', 'confirm'];

describe('PayHeader', () => {
  it('renders all 5 wizard step states (en)', () => {
    for (const step of STEPS) {
      const { unmount } = render(<PayHeader step={step} total="$71.90" lang="en" />);
      expect(screen.getByTestId('pay-header')).toBeInTheDocument();
      const activeIdx = STEPS.indexOf(step);
      expect(screen.getByText(`Application · ${activeIdx + 1} / 5`)).toBeInTheDocument();
      const progressbar = screen.getByRole('progressbar');
      expect(progressbar.getAttribute('aria-valuenow')).toBe(String(activeIdx + 1));
      // Active segments equal step index + 1
      const activeSegments = progressbar.querySelectorAll('[data-active="true"]');
      expect(activeSegments.length).toBe(activeIdx + 1);
      unmount();
    }
  });

  it('translates labels for es', () => {
    render(<PayHeader step="review" total="$71.90" lang="es" />);
    expect(screen.getByText(/Solicitud · 1 \/ 5/)).toBeInTheDocument();
    expect(screen.getByText('Revisar')).toBeInTheDocument();
  });

  it('renders back button only when onBack is supplied', () => {
    const onBack = vi.fn();
    const { rerender } = render(<PayHeader step="review" total="$71.90" lang="en" onBack={onBack} />);
    const back = screen.getByRole('button', { name: /back/i });
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledOnce();

    rerender(<PayHeader step="confirm" total="$71.90" lang="en" />);
    expect(screen.queryByRole('button', { name: /back/i })).toBeNull();
  });

  it('renders the formatted total', () => {
    render(<PayHeader step="payment" total="$107.85" lang="en" />);
    expect(screen.getByText('$107.85')).toBeInTheDocument();
  });
});
