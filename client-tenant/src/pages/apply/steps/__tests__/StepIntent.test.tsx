// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StepIntent } from '../StepIntent';
import { WizardTestProvider, type WizardSeed } from './wizardTestUtils';

function renderAt(seed: WizardSeed = {}, initialPath = '/apply?step=intent') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <WizardTestProvider seed={seed}>
        <Routes>
          <Route path="/apply" element={<StepIntent />} />
        </Routes>
      </WizardTestProvider>
    </MemoryRouter>,
  );
}

describe('StepIntent — W0 AMI prefill', () => {
  it('shows the prefilled-tier chip when qualifyingAmiTier is already set', () => {
    renderAt({ qualifyingAmiTier: '50', grossAnnualIncome: 40000 });
    expect(screen.getByTestId('intent-ami-prefilled')).toBeInTheDocument();
    expect(screen.getByText(/50%/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/gross annual income/i)).not.toBeInTheDocument();
  });

  it('Recalculate collapses the chip and reveals the income input', () => {
    renderAt({ qualifyingAmiTier: '50', grossAnnualIncome: 40000 });
    fireEvent.click(screen.getByTestId('intent-ami-recalc'));
    expect(screen.queryByTestId('intent-ami-prefilled')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/gross annual income/i)).toBeInTheDocument();
  });

  it('falls back to the full income input when no tier is seeded', () => {
    renderAt({ qualifyingAmiTier: null });
    expect(screen.queryByTestId('intent-ami-prefilled')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/gross annual income/i)).toBeInTheDocument();
  });
});
