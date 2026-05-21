// Lane W1 placeholder — Lane W2/W3 owns the real implementation.
import { useNavigate } from 'react-router-dom';
import { useApply } from '../ApplyContext';
import { CTA } from '@/components/primitives';

export default function StepConfirm() {
  const s = useApply();
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <div>TODO Lane W2/W3 — StepConfirm (ref: {s.paymentRef ?? 'pending'})</div>
      <CTA onClick={() => navigate('/dashboard')}>Done</CTA>
    </div>
  );
}
