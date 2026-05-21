import { useSearchParams } from 'react-router-dom';

// FROZEN CONTRACT 1 — full apply flow, in order:
// register · verify · intent · checklist · pick · claim · review · household · payment · details · confirm
// (details === ?step=2; sits between payment and confirm; confirm is terminal)
export const APPLY_STEP_KEYS = [
  'register',
  'verify',
  'intent',
  'checklist',
  'pick',
  'claim',
  'review',
  'household',
  'payment',
  'details',
  'confirm',
] as const;

export type ApplyStepKey = (typeof APPLY_STEP_KEYS)[number];

// Maps the ?step= URL param to the canonical step key.
function rawToKey(raw: string | null): ApplyStepKey {
  switch (raw) {
    case 'verify':
      return 'verify';
    case 'intent':
      return 'intent';
    case 'checklist':
      return 'checklist';
    case 'pick':
      return 'pick';
    case 'claim':
      return 'claim';
    case 'review':
      return 'review';
    case 'household':
      return 'household';
    case 'payment':
      return 'payment';
    case 'confirm':
      return 'confirm';
    case '2':
      return 'details';
    default:
      return 'register';
  }
}

export function useApplyProgress(): {
  current: number;
  total: number;
  stepKey: ApplyStepKey;
} {
  const [search] = useSearchParams();
  const stepKey = rawToKey(search.get('step'));
  const current = APPLY_STEP_KEYS.indexOf(stepKey) + 1;
  return { current, total: APPLY_STEP_KEYS.length, stepKey };
}
