import { useState, type ChangeEvent, type FormEvent } from 'react';

export function useForm<T extends Record<string, unknown>>(
  initialValues: T,
  onSubmit: (values: T) => Promise<void> | void
) {
  const [values, setValues] = useState<T>(initialValues);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    setValues((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : type === 'number' ? (value === '' ? '' : Number(value)) : value,
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setValues(initialValues);
    setError(null);
  }

  return { values, setValues, handleChange, handleSubmit, submitting, error, reset };
}
