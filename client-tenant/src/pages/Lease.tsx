import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, AlertCircle, FileText, Check, ExternalLink } from 'lucide-react';
import { HF } from '@/styles/tokens';
import { Card, CTA } from '@/components/primitives';
import { api } from '@/api/client';

interface LeaseStatus {
  applicationId: string;
  status: string;
  documentUrl: string | null;
  signed: boolean;
  signedAt: string | null;
  signerName: string | null;
}

/**
 * Render a typed name into a small canvas and return a PNG data-URL. This is
 * the "signature image" we persist — a typed-name signature is a valid
 * electronic signature under ESIGN/UETA when paired with explicit consent.
 * Falls back to a `text:`-prefixed string if canvas is unavailable (SSR/tests).
 */
function renderSignature(name: string): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 480;
    canvas.height = 120;
    const ctx = canvas.getContext('2d');
    if (!ctx) return `text:${name}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1a1a1a';
    ctx.font = "italic 44px 'Brush Script MT', 'Segoe Script', cursive";
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 16, 64);
    return canvas.toDataURL('image/png');
  } catch {
    return `text:${name}`;
  }
}

export function Lease() {
  const { t } = useTranslation('lease');
  const navigate = useNavigate();

  const [lease, setLease] = useState<LeaseStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [signerName, setSignerName] = useState('');
  const [consent, setConsent] = useState(false);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<LeaseStatus>('/applicants/me/lease')
      .then((data) => {
        if (!active) return;
        setLease(data);
      })
      .catch((err: Error) => {
        if (!active) return;
        if (/404|No lease/i.test(err.message)) setNotFound(true);
        else setLoadError(err.message);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  const handleSign = useCallback(async () => {
    setSignError(null);
    if (!signerName.trim()) {
      setSignError(t('errorName'));
      return;
    }
    if (!consent) {
      setSignError(t('errorConsent'));
      return;
    }
    setSigning(true);
    try {
      await api.post('/applicants/me/lease/sign', {
        signatureName: signerName.trim(),
        signatureImage: renderSignature(signerName.trim()),
        consent: true,
      });
      navigate('/status');
    } catch (err) {
      setSignError(err instanceof Error ? err.message : t('errorGeneric'));
      setSigning(false);
    }
  }, [signerName, consent, navigate, t]);

  if (loading) {
    return (
      <div style={{ background: HF.cream, minHeight: '60vh' }} className="flex items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin" style={{ color: HF.accent }} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ background: HF.cream, minHeight: '60vh' }} className="p-4">
        <Card variant="mobile" padding={14} style={{ background: HF.errLo, border: `1px solid ${HF.err}` }}>
          <div className="flex items-center gap-2" style={{ color: HF.err }}>
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p style={{ fontFamily: HF.body, fontSize: 13 }}>{loadError}</p>
          </div>
        </Card>
      </div>
    );
  }

  const alreadySigned = !!lease && (lease.signed || lease.status === 'lease_signed' || lease.status === 'onboarded');

  if (notFound || !lease) {
    return (
      <div
        style={{ background: HF.cream, minHeight: '60vh', color: HF.ink, fontFamily: HF.body }}
        className="flex flex-col items-center justify-center gap-4 p-6 text-center"
      >
        <FileText className="h-10 w-10" style={{ color: HF.ink4 }} />
        <p style={{ fontFamily: HF.body, fontSize: 14, color: HF.ink3 }}>{t('noLease')}</p>
        <Link to="/status" style={{ textDecoration: 'none' }}>
          <CTA tone="secondary">{t('backToStatus')}</CTA>
        </Link>
      </div>
    );
  }

  return (
    <div
      style={{ background: HF.cream, minHeight: '100vh', color: HF.ink, fontFamily: HF.body }}
      className="p-4 pb-24 sm:p-6"
    >
      <h1 style={{ fontFamily: HF.display, fontSize: 22, fontWeight: 800, marginBottom: 6 }}>
        {t('title')}
      </h1>
      <p style={{ fontFamily: HF.body, fontSize: 13, color: HF.ink3, marginBottom: 18 }}>
        {t('subtitle')}
      </p>

      {/* Document */}
      <Card variant="mobile" padding={0} style={{ marginBottom: 16 }}>
        <div style={{ padding: '14px 18px' }}>
          <p style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
            {t('documentHeading')}
          </p>
          {lease.documentUrl ? (
            <>
              <object
                data={lease.documentUrl}
                type="application/pdf"
                style={{ width: '100%', height: 320, border: `1px solid ${HF.border}`, borderRadius: HF.r.sm }}
                aria-label={t('documentHeading') as string}
              >
                <p style={{ fontSize: 12, color: HF.ink3 }}>{t('previewUnavailable')}</p>
              </object>
              <a
                href={lease.documentUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  marginTop: 10,
                  fontFamily: HF.body,
                  fontSize: 13,
                  fontWeight: 600,
                  color: HF.accent,
                  textDecoration: 'none',
                }}
              >
                {t('openDocument')} <ExternalLink size={14} />
              </a>
            </>
          ) : (
            <p style={{ fontSize: 12, color: HF.ink3 }}>{t('previewUnavailable')}</p>
          )}
        </div>
      </Card>

      {alreadySigned ? (
        <Card variant="mobile" padding={14} style={{ background: HF.okLo, border: `1px solid ${HF.ok}` }}>
          <div className="flex items-center gap-2" style={{ color: HF.ok }}>
            <Check className="h-5 w-5 shrink-0" strokeWidth={3} />
            <p style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 14 }}>{t('signedTitle')}</p>
          </div>
          <p style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink2, marginTop: 6 }}>{t('signedBody')}</p>
          <Link to="/status" style={{ textDecoration: 'none', display: 'block', marginTop: 12 }}>
            <CTA tone="secondary" block>
              {t('backToStatus')}
            </CTA>
          </Link>
        </Card>
      ) : (
        <Card variant="mobile" padding={0}>
          <div style={{ padding: '14px 18px' }}>
            <p style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 14, marginBottom: 10 }}>
              {t('signatureHeading')}
            </p>

            <label htmlFor="lease-signer-name" style={{ display: 'block', fontSize: 12, fontWeight: 600, color: HF.ink2, marginBottom: 4 }}>
              {t('signatureNameLabel')}
            </label>
            <input
              id="lease-signer-name"
              value={signerName}
              onChange={(e) => setSignerName(e.target.value)}
              placeholder={t('signatureNamePlaceholder') as string}
              autoComplete="name"
              style={{
                width: '100%',
                borderRadius: HF.r.sm,
                border: `1px solid ${HF.border}`,
                padding: '10px 12px',
                fontSize: 16,
                background: HF.paper,
                color: HF.ink,
                fontFamily: HF.body,
                outline: 'none',
              }}
            />

            {/* Live signature preview */}
            {signerName.trim() && (
              <div
                style={{
                  marginTop: 10,
                  padding: '8px 12px',
                  border: `1px dashed ${HF.border}`,
                  borderRadius: HF.r.sm,
                  fontFamily: "'Brush Script MT', 'Segoe Script', cursive",
                  fontStyle: 'italic',
                  fontSize: 28,
                  color: HF.ink,
                }}
              >
                {signerName.trim()}
              </div>
            )}

            <label
              htmlFor="lease-consent"
              style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 14, cursor: 'pointer' }}
            >
              <input
                id="lease-consent"
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3, width: 18, height: 18, flexShrink: 0 }}
              />
              <span style={{ fontFamily: HF.body, fontSize: 12, color: HF.ink2, lineHeight: 1.45 }}>
                {t('consentLabel')}
              </span>
            </label>

            {signError && (
              <div
                role="alert"
                style={{ marginTop: 12, background: HF.errLo, border: `1px solid ${HF.err}`, color: HF.err, padding: 10, borderRadius: HF.r.sm, fontSize: 13 }}
              >
                {signError}
              </div>
            )}

            <CTA
              tone="primary"
              block
              disabled={signing || !signerName.trim() || !consent}
              aria-busy={signing}
              onClick={handleSign}
              style={{ marginTop: 14 }}
            >
              {signing ? t('signing') : t('signCta')}
            </CTA>
          </div>
        </Card>
      )}
    </div>
  );
}

export default Lease;
