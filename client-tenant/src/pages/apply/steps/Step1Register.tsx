import { api } from '@/api/client';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { CTA } from '@/components/primitives';

export function Step1Register() {
  const s = useApply();
  const { t } = useTranslation('apply');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    s.setError(null);
    s.setLoading(true);
    try {
      const res = await api.post<{ ok: boolean; devLink?: string }>('/applicants/register', {
        email: s.email,
        firstName: s.firstName,
        lastName: s.lastName,
        phone: s.phone || undefined,
      });
      if (res.devLink) s.setDevLink(res.devLink);
      s.setStep('verify');
    } catch (err) {
      s.setError(err instanceof Error ? err.message : t('register.error'));
    } finally {
      s.setLoading(false);
    }
  }

  return (
    <>
      <h1 className="mb-4 text-xl font-bold text-gray-900">{t('register.title')}</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="firstName">{t('register.firstName')}</label>
            <input
              id="firstName"
              className="input"
              required
              value={s.firstName}
              onChange={(e) => s.setFirstName(e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="lastName">{t('register.lastName')}</label>
            <input
              id="lastName"
              className="input"
              required
              value={s.lastName}
              onChange={(e) => s.setLastName(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="regEmail">{t('register.email')}</label>
          <input
            id="regEmail"
            type="email"
            className="input"
            required
            value={s.email}
            onChange={(e) => s.setEmail(e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="phone">{t('register.phone')}</label>
          <input
            id="phone"
            type="tel"
            className="input"
            value={s.phone}
            onChange={(e) => s.setPhone(e.target.value)}
            placeholder={t('register.phonePlaceholder')}
          />
        </div>
        <CTA
          type="submit"
          disabled={s.loading || !s.email || !s.firstName || !s.lastName}
        >
          {s.loading ? t('register.submitting') : t('register.submit')}
        </CTA>
      </form>
    </>
  );
}
