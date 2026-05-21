// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AmiCalculator } from '../AmiCalculator';

describe('AmiCalculator', () => {
  it('renders household and income inputs in standalone mode', () => {
    render(<AmiCalculator />);
    expect(screen.getByLabelText(/household size/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/gross annual income/i)).toBeInTheDocument();
  });

  it('hides household input in embedded mode', () => {
    render(<AmiCalculator embeddedHouseholdSize={3} />);
    expect(screen.queryByLabelText(/household size/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/gross annual income/i)).toBeInTheDocument();
  });

  it('computes tier "50" for LV household=4 income=$40k', async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(<AmiCalculator onResult={onResult} />);

    const householdInput = screen.getByLabelText(/household size/i);
    await user.clear(householdInput);
    await user.type(householdInput, '4');

    const incomeInput = screen.getByLabelText(/gross annual income/i);
    await user.type(incomeInput, '40000');

    await user.click(screen.getByRole('button', { name: /calculate/i }));

    expect(screen.getByText(/qualify for 50% AMI units/i)).toBeInTheDocument();
    expect(onResult).toHaveBeenCalledWith({
      tier: '50',
      householdSize: 4,
      grossAnnualIncome: 40000,
    });
  });

  it('shows over-income message when income exceeds 80% cap', async () => {
    const user = userEvent.setup();
    render(<AmiCalculator />);

    const householdInput = screen.getByLabelText(/household size/i);
    await user.clear(householdInput);
    await user.type(householdInput, '4');

    const incomeInput = screen.getByLabelText(/gross annual income/i);
    await user.type(incomeInput, '120000');

    await user.click(screen.getByRole('button', { name: /calculate/i }));

    expect(
      screen.getByText(/over income for affordable tiers/i),
    ).toBeInTheDocument();
  });

  it('accepts income strings with $ and commas', async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(
      <AmiCalculator embeddedHouseholdSize={4} onResult={onResult} />,
    );

    const incomeInput = screen.getByLabelText(/gross annual income/i);
    await user.type(incomeInput, '$40,000');

    await user.click(screen.getByRole('button', { name: /calculate/i }));

    expect(onResult).toHaveBeenCalledWith({
      tier: '50',
      householdSize: 4,
      grossAnnualIncome: 40000,
    });
  });

  it('uses parent-provided household size in embedded mode', async () => {
    const onResult = vi.fn();
    const user = userEvent.setup();
    render(
      <AmiCalculator embeddedHouseholdSize={2} onResult={onResult} />,
    );

    const incomeInput = screen.getByLabelText(/gross annual income/i);
    await user.type(incomeInput, '30000');

    await user.click(screen.getByRole('button', { name: /calculate/i }));

    expect(onResult).toHaveBeenCalledWith(
      expect.objectContaining({ householdSize: 2 }),
    );
  });

  it('button is disabled until income is entered', () => {
    render(<AmiCalculator />);
    expect(
      screen.getByRole('button', { name: /calculate/i }),
    ).toBeDisabled();
  });

  it('does not show result until calculate is clicked', () => {
    render(<AmiCalculator />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
