import { api } from '@/api/client';
import { useApply } from '../ApplyContext';
import { useTranslation } from 'react-i18next';
import { CTA } from '@/components/primitives';
import { HF } from '@/styles/tokens';

const labelStyle = {
  display: 'block',
  marginBottom: 4,
  fontSize: 13,
  fontWeight: 500,
  color: HF.ink,
  fontFamily: HF.body,
} as const;

const inputStyle = {
  width: '100%',
  borderRadius: HF.r.sm,
  border: `1px solid ${HF.border}`,
  padding: '8px 12px',
  fontSize: 14,
  background: HF.paper,
  color: HF.ink,
  fontFamily: HF.body,
  outline: 'none',
} as const;

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
      <h1
        className="mb-4 text-xl font-bold"
        style={{ fontFamily: HF.display, color: HF.ink }}
      >
        {t('register.title')}
      </h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label style={labelStyle} htmlFor="firstName">{t('register.firstName')}</label>
            <input
              id="firstName"
              style={inputStyle}
              required
              value={s.firstName}
              onChange={(e) => s.setFirstName(e.target.value)}
            />
          </div>
          <div>
            <label style={labelStyle} htmlFor="lastName">{t('register.lastName')}</label>
            <input
              id="lastName"
              style={inputStyle}
              required
              value={s.lastName}
              onChange={(e) => s.setLastName(e.target.value)}
            />
          </div>
        </div>
        <div>
          <label style={labelStyle} htmlFor="regEmail">{t('register.email')}</label>
          <input
            id="regEmail"
            type="email"
            style={inputStyle}
            required
            value={s.email}
            onChange={(e) => s.setEmail(e.target.value)}
          />
        </div>
        <div>
          <label style={labelStyle} htmlFor="phone">{t('register.phone')}</label>
          <input
            id="phone"
            type="tel"
            style={inputStyle}
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
