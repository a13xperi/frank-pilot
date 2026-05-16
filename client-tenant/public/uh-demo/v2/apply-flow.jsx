// V2 · Apply flow — 5-screen mobile sequence after the user taps "Apply for
// this home" on the property detail. Same screens as v1's payment-flow,
// rebuilt to the Universal Housing design system. Uses real Juan Garcia data
// from data.jsx.

function ApplyHeader({ step = 1, total = 5 }) {
  const names = ['Review', 'Household', 'Payment', 'Details', 'Confirm'];
  return (
    <div style={{
      padding: '8px 20px 14px', background: HF.paper,
      borderBottom: `1px solid ${HF.border}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button style={{
          width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
          border: `1px solid ${HF.border}`, cursor: 'pointer',
          display: 'grid', placeItems: 'center',
        }}>
          <Icon name="arrowLeft" size={16} color={HF.ink} />
        </button>
        <div style={{ flex: 1 }}>
          <Eyebrow>Universal Housing</Eyebrow>
          <P size={11} color={HF.ink3} style={{ marginTop: 1 }}>
            Application · Step {step} of {total}
          </P>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 4 }}>
        {Array.from({ length: total }).map((_, i) => (
          <div key={i} style={{
            flex: 1, height: 4, borderRadius: 99,
            background: i < step - 1 ? HF.ok : i === step - 1 ? HF.accent : '#E2DCCC',
          }} />
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
        {names.map((n, i) => (
          <span key={i} style={{
            fontFamily: HF.body, fontSize: 10, fontWeight: i === step - 1 ? 700 : 500,
            color: i === step - 1 ? HF.ink : HF.ink3,
          }}>{n}</span>
        ))}
      </div>
    </div>
  );
}

// SCREEN 1 — Review boarding-pass-style summary
function V2Review() {
  const p = propBySlug('juan-garcia');
  return (
    <MobileFrame label="Apply 1 · review" h={1700}>
      <ApplyHeader step={1} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Confirm what you're applying for</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Review before paying. You can edit any field.
          </P>
        </div>

        {/* Boarding pass */}
        <Surface raised style={{ overflow: 'hidden', position: 'relative' }}>
          <PropertyImage src={p.photo} ratio="2 / 1" />
          <div style={{ padding: '16px 18px 18px' }}>
            <Eyebrow>Applying for</Eyebrow>
            <H2 style={{ fontSize: 20, marginTop: 4 }}>{p.name}</H2>
            <P size={12} color={HF.ink3}>{p.address}</P>

            <div style={{
              marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${HF.border}`,
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12,
            }}>
              {[
                { l: 'Unit', v: '2BR', big: true },
                { l: 'Size', v: '905 sqft' },
                { l: 'Floor', v: '2' },
              ].map((f, i) => (
                <div key={i}>
                  <Eyebrow color={HF.ink3}>{f.l}</Eyebrow>
                  <div style={{
                    fontFamily: HF.display, fontWeight: 800,
                    fontSize: f.big ? 24 : 16,
                    color: f.big ? HF.accent : HF.ink, marginTop: 2,
                  }}>{f.v}</div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: 14, paddingTop: 14, borderTop: `1px dashed ${HF.border}`,
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            }}>
              <div>
                <Eyebrow color={HF.ink3}>Monthly rent</Eyebrow>
                <div style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 18, marginTop: 2 }}>
                  {p.rentRange}
                </div>
              </div>
              <Tag tone="warn">● Waitlist #12 of 38</Tag>
            </div>
          </div>
        </Surface>

        {/* Locked criteria */}
        <Surface>
          <div style={{ padding: '12px 14px' }}>
            <Eyebrow color={HF.ink3}>Your locked criteria</Eyebrow>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {['2BR', 'Family', 'East Las Vegas', '<$50k income', 'Any floor'].map((c, i) => (
                <Chip key={i}>{c}</Chip>
              ))}
            </div>
          </div>
        </Surface>

        {/* Confirmation prompt */}
        <Surface>
          <div style={{ padding: '14px 16px', display: 'flex', gap: 12 }}>
            <Icon name="warning" size={22} color={HF.warn} />
            <div>
              <P size={13} weight={600} color={HF.ink}>Is this what you wanted?</P>
              <P size={12} color={HF.ink3} style={{ marginTop: 2 }}>
                Your application and $35.95 fee are tied to this exact property and unit.
              </P>
            </div>
          </div>
        </Surface>

        <div style={{ marginTop: 4 }}>
          <span data-uh-routed="true"
                onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-2')}>
            <Button variant="primary" size="lg" full>
              Yes, reserve my spot
              <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
            </Button>
          </span>
          <div style={{ textAlign: 'center', marginTop: 10 }}>
            <button data-uh-routed="true"
                    onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('detail')} style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: HF.body, fontSize: 13, fontWeight: 600, color: HF.ink3,
              textDecoration: 'underline',
            }}>No, let me change my selection</button>
          </div>
        </div>
      </div>
    </MobileFrame>
  );
}

// SCREEN 2 — Household + fee calc
function V2Household() {
  const adults = 2;
  const total = (COMPLIANCE.feePerAdult * adults).toFixed(2);
  return (
    <MobileFrame label="Apply 2 · household + fee" h={1500}>
      <ApplyHeader step={2} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Who will live here?</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Your application fee ($35.95/adult 18+) reserves your spot on the waitlist.
          </P>
        </div>

        {/* Counters */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <H3 style={{ fontSize: 16 }}>Adults (18+)</H3>
                <P size={11} color={HF.ink3}>Each must pay & sign.</P>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button style={{
                  width: 36, height: 36, borderRadius: HF.r.pill, border: `1px solid ${HF.border}`,
                  background: HF.paper, cursor: 'pointer', fontFamily: HF.display, fontSize: 18, fontWeight: 700,
                }}>−</button>
                <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 26, minWidth: 24, textAlign: 'center' }}>
                  {adults}
                </span>
                <button style={{
                  width: 36, height: 36, borderRadius: HF.r.pill, border: 'none',
                  background: HF.accent, color: HF.paper, cursor: 'pointer', fontFamily: HF.display, fontSize: 18, fontWeight: 700,
                }}>+</button>
              </div>
            </div>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${HF.border}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div>
                <H3 style={{ fontSize: 16 }}>Children</H3>
                <P size={11} color={HF.ink3}>No fee required.</P>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <button style={{
                  width: 36, height: 36, borderRadius: HF.r.pill, border: `1px solid ${HF.border}`,
                  background: HF.paper, cursor: 'pointer', fontFamily: HF.display, fontSize: 18, fontWeight: 700,
                }}>−</button>
                <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 26, minWidth: 24, textAlign: 'center' }}>1</span>
                <button style={{
                  width: 36, height: 36, borderRadius: HF.r.pill, border: `1px solid ${HF.border}`,
                  background: HF.paper, cursor: 'pointer', fontFamily: HF.display, fontSize: 18, fontWeight: 700,
                }}>+</button>
              </div>
            </div>
          </div>
        </Surface>

        {/* Fee tape */}
        <div style={{
          padding: 16, borderRadius: HF.r.lg, background: HF.accentLo,
          border: `1px solid #F3D7CB`,
        }}>
          <Eyebrow color={HF.accent}>Fee calculator</Eyebrow>
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between' }}>
            <P size={13}>${COMPLIANCE.feePerAdult} × {adults} adults</P>
            <P size={13} weight={600}>${(COMPLIANCE.feePerAdult * adults).toFixed(2)}</P>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
            <P size={13} color={HF.ink3}>Processing (included)</P>
            <P size={13} color={HF.ink3}>$0.00</P>
          </div>
          <div style={{
            marginTop: 12, paddingTop: 12, borderTop: `2px solid ${HF.accent}`,
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
          }}>
            <H3>Total due</H3>
            <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 28, color: HF.accent }}>
              ${total}
            </span>
          </div>
          <P size={11} color={HF.ink3} style={{ marginTop: 6 }}>
            Non-refundable · funds credit, employment & background checks.
          </P>
        </div>

        <span data-uh-routed="true"
              onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-3')}>
          <Button variant="primary" size="lg" full>
            Continue to payment · ${total}
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
      </div>
    </MobileFrame>
  );
}

// SCREEN 3 — Payment (Heartland / Loft dual gateway per debrief)
function V2Payment() {
  return (
    <MobileFrame label="Apply 3 · payment" h={1700}>
      <ApplyHeader step={3} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Secure payment</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            Processed by Heartland or Loft. Credit/debit only — no cash, no checks.
          </P>
        </div>

        <Surface>
          <div style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 48, height: 36, borderRadius: HF.r.sm,
              background: `#c4b496 url(${propBySlug('juan-garcia').photo}) center/cover`,
              flex: '0 0 48px',
            }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <Eyebrow color={HF.ink3}>Paying for</Eyebrow>
              <P size={13} weight={700} style={{ marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                Juan Garcia Garden Apts
              </P>
              <P size={11} color={HF.ink3}>2BR · 2 adults</P>
            </div>
            <div style={{ textAlign: 'right' }}>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 18 }}>$71.90</span>
              <P size={10} color={HF.ink3}>non-refundable</P>
            </div>
          </div>
        </Surface>

        {/* Card fields */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            { l: 'Card number', v: '4242  4242  4242  4242', brand: 'VISA' },
            { l: 'Expiry', v: '12 / 27', half: 'left' },
            { l: 'CVC', v: '•••', half: 'right' },
            { l: 'Cardholder name', v: 'Marisol R. Cabrera' },
            { l: 'ZIP code', v: '89106', half: 'left', short: true },
          ].reduce((acc, f, i, arr) => {
            // Group half-width fields side by side
            if (f.half === 'left' && arr[i+1] && arr[i+1].half === 'right') {
              acc.push(
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <FormField {...f} />
                  <FormField {...arr[i+1]} />
                </div>
              );
              arr[i+1]._consumed = true;
            } else if (!f._consumed) {
              acc.push(<FormField key={i} {...f} />);
            }
            return acc;
          }, [])}
        </div>

        {/* Alt payment */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1, height: 1, background: HF.border }} />
          <P size={11} color={HF.ink3}>or</P>
          <div style={{ flex: 1, height: 1, background: HF.border }} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-4')}>
            <Button variant="secondary" size="md">Apple Pay</Button>
          </span>
          <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-4')}>
            <Button variant="secondary" size="md">Google Pay</Button>
          </span>
        </div>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-4')}>
          <Button variant="primary" size="lg" full>
            Pay $71.90
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
        <div style={{ textAlign: 'center' }}>
          <P size={11} color={HF.ink3}>🔒 PCI-DSS encrypted · Heartland & Loft</P>
        </div>
      </div>
    </MobileFrame>
  );
}

function FormField({ l, v, brand, short }) {
  return (
    <div>
      <Eyebrow color={HF.ink3}>{l}</Eyebrow>
      <div style={{
        marginTop: 4, padding: '0 14px', height: 44,
        borderRadius: HF.r.md, border: `1px solid ${HF.borderHi}`, background: HF.paper,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        width: short ? 120 : '100%',
      }}>
        <span style={{ fontFamily: HF.mono, fontSize: 13, color: HF.ink }}>{v}</span>
        {brand && <span style={{ fontFamily: HF.display, fontWeight: 700, fontSize: 11, color: HF.ink3 }}>{brand}</span>}
      </div>
    </div>
  );
}

// SCREEN 4 — Application details (locks position post-payment)
function V2Details() {
  return (
    <MobileFrame label="Apply 4 · details (locks position)" h={1900}>
      <ApplyHeader step={4} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div>
          <H2 style={{ fontSize: 22 }}>Application details</H2>
          <P size={13} color={HF.ink3} style={{ marginTop: 4 }}>
            This locks your spot. Your property is pre-selected.
          </P>
        </div>

        {/* Locked property pill */}
        <Surface raised style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 32, height: 32, borderRadius: HF.r.sm, background: HF.accent, color: HF.paper,
              display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 14,
            }}>2</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <P size={13} weight={700}>Juan Garcia · 2BR</P>
              <P size={11} color={HF.ink3}>905 sqft · Paid ✓</P>
            </div>
            <Tag tone="ok">🔒 Locked</Tag>
          </div>
        </Surface>

        {/* Identity */}
        <Section title="Identity">
          <FormField l="Social Security number *" v="•••-••-4421" />
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 10, marginTop: 10 }}>
            <FormField l="Date of birth *" v="04 / 18 / 1968" />
            <FormField l="HH size *" v="3" />
          </div>
        </Section>

        {/* Address */}
        <Section title="Current address">
          <FormField l="Street" v="1408 E Charleston Blvd, Apt 6" />
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginTop: 10 }}>
            <FormField l="City" v="Las Vegas" />
            <FormField l="State" v="NV" />
            <FormField l="ZIP" v="89104" />
          </div>
        </Section>

        {/* Employment */}
        <Section title="Employment & income">
          <FormField l="Employer" v="Las Vegas Unified Schools" />
          <div style={{ marginTop: 10 }}>
            <FormField l="Annual HH income" v="$42,800" />
          </div>
          <div style={{
            marginTop: 8, padding: '8px 10px', borderRadius: HF.r.sm,
            background: HF.okLo, border: `1px solid #CFE1CB`,
            display: 'flex', alignItems: 'center', gap: 6,
          }}>
            <Icon name="check" size={14} color={HF.ok} />
            <P size={11} weight={600} color={HF.ok}>You qualify under 50/60% AMI</P>
          </div>
        </Section>

        {/* Move-in */}
        <Section title="Move-in">
          <FormField l="Requested date *" v="07 / 15 / 2026" />
        </Section>

        <Surface>
          <div style={{ padding: '10px 12px' }}>
            <P size={11} color={HF.ink3}>
              ⚠ Honest answers required. You attest under penalty of perjury. Spot locks on submit.
            </P>
          </div>
        </Surface>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('apply-5')}>
          <Button variant="primary" size="lg" full>
            Submit & lock my spot
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
      </div>
    </MobileFrame>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <Eyebrow color={HF.ink3}>{title}</Eyebrow>
      <div style={{ height: 6 }} />
      {children}
    </div>
  );
}

// SCREEN 5 — Confirmation
function V2Confirm() {
  return (
    <MobileFrame label="Apply 5 · on the waitlist" h={1700}>
      <ApplyHeader step={5} />
      <div style={{ padding: '20px 20px 28px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ textAlign: 'center', padding: '14px 0 4px' }}>
          <div style={{
            width: 72, height: 72, borderRadius: HF.r.pill, margin: '0 auto',
            background: HF.warnLo, border: `3px solid ${HF.warn}`,
            display: 'grid', placeItems: 'center',
          }}>
            <span style={{ fontSize: 32 }}>⏳</span>
          </div>
        </div>
        <H1 style={{ fontSize: 28, textAlign: 'center' }}>You're on the waitlist!</H1>
        <P size={13} color={HF.ink3} style={{ textAlign: 'center' }}>
          You're on the 2BR waitlist at Juan Garcia. Your spot #12 is reserved.
        </P>

        {/* Recapture banner */}
        <Surface raised style={{ background: HF.accentLo, borderColor: '#F3D7CB' }}>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 28 }}>💸</span>
            <div style={{ flex: 1 }}>
              <H3 style={{ fontSize: 15, color: HF.accent }}>Recapture your $71.90 fee</H3>
              <P size={12} color={HF.ink2} style={{ marginTop: 4 }}>
                Enroll in auto-pay when you sign your lease → get $10/month off rent. ~7 months to break even.
              </P>
              <div style={{ marginTop: 10 }}>
                <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('acct-profile')}>
                  <Button variant="primary" size="sm">Reserve my discount</Button>
                </span>
              </div>
            </div>
          </div>
        </Surface>

        {/* Receipt */}
        <Surface>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name="check" size={14} color={HF.ok} />
              <Eyebrow color={HF.ok}>Confirmed for</Eyebrow>
              <span style={{ marginLeft: 'auto', fontFamily: HF.mono, fontSize: 11, color: HF.ink3 }}>
                #APP-26-9341
              </span>
            </div>
            <H3 style={{ fontSize: 16, marginTop: 6 }}>Juan Garcia Garden Apartments</H3>
            <P size={11} color={HF.ink3}>2BR · 2851 Sunrise Ave, Las Vegas NV 89101</P>
            <div style={{
              marginTop: 12, paddingTop: 12, borderTop: `1px dashed ${HF.border}`,
              display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8,
            }}>
              {[
                { l: 'Paid', v: '$71.90' },
                { l: 'Date', v: 'May 14' },
                { l: '2BR list', v: '#12', color: HF.warn },
              ].map((f, i) => (
                <div key={i}>
                  <Eyebrow color={HF.ink3}>{f.l}</Eyebrow>
                  <div style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 14, color: f.color || HF.ink, marginTop: 2 }}>
                    {f.v}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <Surface>
          <div style={{ padding: '12px 14px' }}>
            <H3 style={{ fontSize: 14 }}>What happens next</H3>
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                'We email + SMS you as your spot moves up.',
                'PM reviews your application within 2–3 business days.',
                'You sign your lease & addenda via DocuSign.',
              ].map((line, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 20, height: 20, borderRadius: HF.r.pill, flex: '0 0 20px',
                    background: HF.accent, color: HF.paper,
                    display: 'grid', placeItems: 'center',
                    fontFamily: HF.display, fontWeight: 800, fontSize: 11,
                  }}>{i + 1}</div>
                  <P size={12} style={{ flex: 1 }}>{line}</P>
                </div>
              ))}
            </div>
          </div>
        </Surface>

        <span data-uh-routed="true" onClick={() => window.__UH_GO_TO__ && window.__UH_GO_TO__('wl-dash')}>
          <Button variant="primary" size="lg" full>
            View my application
            <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
          </Button>
        </span>
      </div>
    </MobileFrame>
  );
}

Object.assign(window, {
  V2Review, V2Household, V2Payment, V2Details, V2Confirm,
});
