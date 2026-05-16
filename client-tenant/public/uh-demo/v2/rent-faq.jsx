// V2 · "How Is My Rent Calculated?" — plain-language explainer per C2.9.
// Brand-defining trust screen: no other affordable housing app explains the
// math this transparently. 8-step narrative + closing summary.

function V2RentFAQ() {
  const steps = [
    {
      n: 1, icon: '📤',
      title: 'You upload your documents',
      body: 'Pay stubs, Social Security letters, bank statements, tax returns. Take a photo with your phone or upload a file — we walk you through what\'s needed.',
    },
    {
      n: 2, icon: '🔍',
      title: 'We read your documents automatically',
      body: 'Smart technology pulls out the important numbers — how much you earn, how often you\'re paid, what\'s in your bank accounts. No re-typing.',
    },
    {
      n: 3, icon: '📋',
      title: 'Your numbers go into a rent worksheet',
      body: 'The same official worksheet the government requires. Pay stubs → "Employment Income" line. Social Security → "Pensions" line.',
    },
    {
      n: 4, icon: '🧮',
      title: 'Your rent is calculated automatically',
      body: 'We do the math following the exact government rules. Total your income, apply deductions you qualify for (medical, child care), calculate your share.',
    },
    {
      n: 5, icon: '⚠️',
      title: 'Unclear items get flagged',
      body: 'If a document was blurry or hard to read, it\'s flagged for a real person to verify. Nothing gets finalized without human review.',
    },
    {
      n: 6, icon: '👤',
      title: 'Your Property Manager reviews everything',
      body: 'Side-by-side with your original documents. They confirm every number, approve or adjust, sign off. You see exactly where each value came from.',
    },
    {
      n: 7, icon: '🗂',
      title: 'Everything is saved for your records',
      body: 'Every document, every extracted number, every calculation, every approval — saved and linked. Audit-ready, anytime.',
    },
    {
      n: 8, icon: '🔄',
      title: 'Renewals are easier',
      body: 'Next year, we remember everything. Only upload what\'s changed (new pay stub, updated bank statement). Unchanged values carry forward.',
    },
  ];

  return (
    <MobileFrame label="How rent is calculated · plain language" h={2400}>
      <div style={{
        padding: '12px 20px 16px', background: HF.paper, borderBottom: `1px solid ${HF.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button style={{
            width: 36, height: 36, borderRadius: HF.r.pill, background: HF.cream,
            border: `1px solid ${HF.border}`, cursor: 'pointer',
            display: 'grid', placeItems: 'center',
          }}>
            <Icon name="arrowLeft" size={16} color={HF.ink} />
          </button>
          <div style={{ flex: 1 }}>
            <Eyebrow>Universal Housing</Eyebrow>
            <P size={11} color={HF.ink3}>My account → Rent details</P>
          </div>
        </div>
      </div>

      <div style={{ padding: '24px 20px 32px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <Tag tone="sage" style={{ marginBottom: 8 }}>🌱 Plain language guide</Tag>
          <H1 style={{ fontSize: 30 }}>How is my rent calculated?</H1>
          <P size={14} color={HF.ink2} style={{ marginTop: 10, lineHeight: 1.6 }}>
            Affordable housing rent rules are complex. Universal Housing handles the math
            so you don't have to — and here's exactly how it works, in plain English.
          </P>
        </div>

        <Surface>
          <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 22 }}>🔊</span>
            <P size={12} color={HF.ink2} style={{ flex: 1 }}>
              <b>Listen to this page</b> · also available in Spanish
            </P>
            <Button variant="secondary" size="sm">Play</Button>
          </div>
        </Surface>

        {/* 8 steps */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {steps.map((s, i) => (
            <Surface key={i}>
              <div style={{ padding: '14px 16px', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: HF.r.pill, flex: '0 0 40px',
                  background: HF.cream, border: `1.5px solid ${HF.accent}`,
                  display: 'grid', placeItems: 'center',
                  fontFamily: HF.display, fontWeight: 800, fontSize: 16, color: HF.accent,
                }}>{s.n}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 18 }}>{s.icon}</span>
                    <H3 style={{ fontSize: 15 }}>{s.title}</H3>
                  </div>
                  <P size={13} color={HF.ink2} style={{ marginTop: 4 }}>{s.body}</P>
                </div>
              </div>
            </Surface>
          ))}
        </div>

        {/* Bottom line */}
        <Surface raised style={{ background: HF.sageLo, borderColor: '#D2DDC9' }}>
          <div style={{ padding: '16px 18px' }}>
            <Eyebrow color={HF.sage}>Bottom line</Eyebrow>
            <P size={14} color={HF.ink} style={{ marginTop: 8, lineHeight: 1.6 }}>
              The app handles the math and the paperwork so you don't have to.
              Upload, we read, we calculate, your PM confirms. Faster, more accurate,
              and more transparent than the old paper process — and you can see
              exactly how your rent was determined at any time.
            </P>
          </div>
        </Surface>

        <Button variant="primary" size="lg" full>
          See my rent calculation
          <Icon name="arrow" size={16} color={HF.paper} style={{ marginLeft: 4 }} />
        </Button>
      </div>
    </MobileFrame>
  );
}

window.V2RentFAQ = V2RentFAQ;
