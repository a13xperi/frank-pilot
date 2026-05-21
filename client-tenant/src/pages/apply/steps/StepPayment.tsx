// Lane W1 placeholder — Lane W2/W3 owns the real implementation.
import { useNavigate } from 'react-router-dom';
import { useApply } from '../ApplyContext';
import { CTA } from '@/components/primitives';

export default function StepPayment() {
  const s = useApply();
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <div>TODO Lane W2/W3 — StepPayment (total: {s.paymentTotal})</div>
      <CTA onClick={() => navigate('/apply?step=2')}>Continue</CTA>
    </div>
  );
}
