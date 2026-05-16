// V2 · Document upload → Calc Tape side-by-side review (PM screen).
// Per C2.8 — the PM time-saver. Left: tenant's uploaded pay stub with
// highlighted extraction zones. Right: pre-populated calc tape with
// confidence scores. PM accepts / overrides / re-requests.
//
// Desktop split-screen view. The differentiator vs. every other affordable
// housing tool — turns 45-minute manual entry into 4-minute review.

function V2CalcTapeReview() {
  return (
    <div style={{
      minHeight: '100vh', background: HF.cream, fontFamily: HF.body, color: HF.ink,
    }}>
      <AppHeader active="apply" />

      <div style={{
        background: HF.paper, borderBottom: `1px solid ${HF.border}`, padding: '20px 28px',
      }}>
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 44, height: 44, borderRadius: HF.r.pill, background: HF.cream,
            display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 16,
          }}>MC</div>
          <div style={{ flex: 1 }}>
            <Eyebrow>Application #APP-26-9341 · Calc tape review</Eyebrow>
            <H2 style={{ fontSize: 22, marginTop: 2 }}>Marisol R. Cabrera · Juan Garcia · 2BR</H2>
          </div>
          <Tag tone="warn">7 items need review</Tag>
          <Button variant="secondary" size="md">Save draft</Button>
          <Button variant="primary" size="md">Approve all & lock</Button>
        </div>
      </div>

      <div style={{
        maxWidth: 1400, margin: '0 auto', padding: '20px 28px',
        display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'start',
      }}>
        {/* LEFT — Document viewer */}
        <Surface raised>
          <div style={{
            padding: '12px 16px', borderBottom: `1px solid ${HF.border}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <Tag tone="neutral">📄 Document 3 of 5</Tag>
            <H3 style={{ fontSize: 14 }}>Pay stub · Las Vegas Unified Schools</H3>
            <span style={{ marginLeft: 'auto', fontFamily: HF.body, fontSize: 11, color: HF.ink3 }}>
              uploaded May 14 · 2:14 PM
            </span>
          </div>

          {/* Fake pay stub with highlight boxes */}
          <div style={{ padding: 16, background: HF.cream, minHeight: 720, position: 'relative' }}>
            <div style={{
              background: HF.paper, padding: 24, borderRadius: HF.r.md,
              boxShadow: HF.shadow.sm, position: 'relative',
              fontFamily: HF.mono, fontSize: 11, color: HF.ink, lineHeight: 1.6,
            }}>
              <div style={{ borderBottom: `2px solid ${HF.ink}`, paddingBottom: 8, marginBottom: 12 }}>
                <div style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 14 }}>
                  LAS VEGAS UNIFIED SCHOOL DISTRICT
                </div>
                <div style={{ fontSize: 10, color: HF.ink3 }}>
                  4204 Channel 10 Dr · Las Vegas, NV 89119
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
                <div>
                  <div style={{ color: HF.ink3, fontSize: 9 }}>EMPLOYEE</div>
                  <div style={{
                    background: '#FEF3C7', padding: '2px 4px', borderRadius: 3,
                    border: '1.5px solid #F59E0B', display: 'inline-block',
                  }}>Marisol R. Cabrera</div>
                </div>
                <div>
                  <div style={{ color: HF.ink3, fontSize: 9 }}>PERIOD ENDING</div>
                  <div>May 09, 2026</div>
                </div>
              </div>

              <table style={{ width: '100%', fontFamily: HF.mono, fontSize: 11, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${HF.border}` }}>
                    <th style={{ textAlign: 'left', padding: 4, fontSize: 9, color: HF.ink3, fontWeight: 600 }}>EARNINGS</th>
                    <th style={{ textAlign: 'right', padding: 4, fontSize: 9, color: HF.ink3, fontWeight: 600 }}>RATE</th>
                    <th style={{ textAlign: 'right', padding: 4, fontSize: 9, color: HF.ink3, fontWeight: 600 }}>HOURS</th>
                    <th style={{ textAlign: 'right', padding: 4, fontSize: 9, color: HF.ink3, fontWeight: 600 }}>THIS PERIOD</th>
                    <th style={{ textAlign: 'right', padding: 4, fontSize: 9, color: HF.ink3, fontWeight: 600 }}>YTD</th>
                  </tr>
                </thead>
                <tbody>
                  <tr><td style={{ padding: 4 }}>Regular</td><td style={{ textAlign: 'right', padding: 4 }}>$23.50</td><td style={{ textAlign: 'right', padding: 4 }}>70.00</td><td style={{ textAlign: 'right', padding: 4 }}>$1,645.00</td><td style={{ textAlign: 'right', padding: 4 }}>$15,510.00</td></tr>
                  <tr><td style={{ padding: 4 }}>Overtime</td><td style={{ textAlign: 'right', padding: 4 }}>$35.25</td><td style={{ textAlign: 'right', padding: 4 }}>0.00</td><td style={{ textAlign: 'right', padding: 4 }}>$0.00</td><td style={{ textAlign: 'right', padding: 4 }}>$340.00</td></tr>
                  <tr style={{ borderTop: `2px solid ${HF.ink}`, fontWeight: 700 }}>
                    <td style={{ padding: 4 }}>GROSS</td><td></td><td></td>
                    <td style={{
                      textAlign: 'right', padding: 4,
                      background: '#FEF3C7', borderRadius: 3,
                      border: '1.5px solid #F59E0B',
                    }}>$1,645.00</td>
                    <td style={{
                      textAlign: 'right', padding: 4,
                      background: '#DCFCE7', borderRadius: 3,
                      border: '1.5px solid #22C55E',
                    }}>$15,850.00</td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 14, fontSize: 9, color: HF.ink3 }}>
                Pay frequency: Bi-weekly · Annualized: $42,800 · This is page 1 of 1
              </div>
            </div>

            {/* Highlight key */}
            <div style={{
              marginTop: 14, padding: '8px 12px', borderRadius: HF.r.sm,
              background: HF.paper, border: `1px solid ${HF.border}`,
              display: 'flex', gap: 12, fontSize: 11,
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, background: '#DCFCE7', border: '1.5px solid #22C55E', borderRadius: 2 }} />
                <span style={{ color: HF.ink3 }}>high confidence (95%+)</span>
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 10, height: 10, background: '#FEF3C7', border: '1.5px solid #F59E0B', borderRadius: 2 }} />
                <span style={{ color: HF.ink3 }}>needs review (85–94%)</span>
              </span>
            </div>
          </div>
        </Surface>

        {/* RIGHT — Calc tape */}
        <Surface raised>
          <div style={{
            padding: '12px 16px', borderBottom: `1px solid ${HF.border}`,
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <H3 style={{ fontSize: 14 }}>HUD-50059 Calculator Tape</H3>
            <Tag tone="ok">5 / 8 verified</Tag>
            <span style={{ marginLeft: 'auto' }}>
              <Button variant="ghost" size="sm">Print</Button>
            </span>
          </div>

          {/* Part B — Income */}
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${HF.border}` }}>
            <Eyebrow color={HF.ink3}>Part B · Annual income (from documents)</Eyebrow>
            <div style={{ height: 8 }} />
            {[
              { l: 'Employment income (Line 1)', v: '$42,800', conf: 96, src: 'Pay stub #3, page 1 (annualized)', accepted: true },
              { l: 'Social Security / Pensions (Line 2)', v: '$0', conf: 100, src: 'No documents present', accepted: true },
              { l: 'Business income (Line 3)', v: '$0', conf: 100, src: 'Tax return Schedule C — none', accepted: true },
              { l: 'Asset income — interest/dividends', v: '$48', conf: 88, src: 'Bank statement, May avg', flag: true },
            ].map((row, i) => (
              <CalcRow key={i} {...row} />
            ))}

            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: HF.r.sm,
              background: HF.cream, display: 'flex', justifyContent: 'space-between',
            }}>
              <P size={12} weight={700}>Total annual income</P>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 16 }}>$42,848</span>
            </div>
          </div>

          {/* Part C — Deductions */}
          <div style={{ padding: '14px 16px', borderBottom: `1px solid ${HF.border}` }}>
            <Eyebrow color={HF.ink3}>Part C · Deductions</Eyebrow>
            <div style={{ height: 8 }} />
            {[
              { l: '$480 × 1 dependent (Sofia, age 14)', v: '$480', conf: 100, src: 'HH composition', accepted: true },
              { l: 'Child care', v: '$0', conf: 100, src: 'None reported', accepted: true },
              { l: 'Medical (elderly/disabled only)', v: '$0', conf: 100, src: 'N/A — under 62, not disabled', accepted: true },
            ].map((row, i) => (
              <CalcRow key={i} {...row} />
            ))}
            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: HF.r.sm,
              background: HF.cream, display: 'flex', justifyContent: 'space-between',
            }}>
              <P size={12} weight={700}>Total deductions</P>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 16 }}>$480</span>
            </div>
          </div>

          {/* TTP calc */}
          <div style={{ padding: '14px 16px', background: HF.sageLo }}>
            <Eyebrow color={HF.sage}>Total tenant payment</Eyebrow>
            <div style={{ height: 6 }} />
            <P size={11} color={HF.ink2}>Greater of 30% adjusted or 10% gross (HUD 4350.3 Ch. 5-25):</P>
            <div style={{ marginTop: 6, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <P size={11} color={HF.ink3}>30% × adjusted ÷ 12</P>
                <P size={13} weight={700}>$1,059 / mo</P>
              </div>
              <div>
                <P size={11} color={HF.ink3}>10% × gross ÷ 12</P>
                <P size={13} weight={700}>$357 / mo</P>
              </div>
            </div>
            <div style={{
              marginTop: 10, padding: '10px 12px', borderRadius: HF.r.sm,
              background: HF.paper, border: `2px solid ${HF.sage}`,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <P size={12} weight={700}>Calculated TTP</P>
              <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 20, color: HF.sage }}>$964 / mo</span>
            </div>
            <P size={10} color={HF.ink3} style={{ marginTop: 4 }}>
              Capped at 2BR LIHTC rent for Juan Garcia ($964) — below greater-of result.
            </P>
          </div>
        </Surface>
      </div>
    </div>
  );
}

function CalcRow({ l, v, conf, src, accepted, flag }) {
  const tone = flag ? '#F59E0B' : accepted ? HF.ok : HF.warn;
  const bg = flag ? '#FEF3C7' : accepted ? HF.okLo : HF.warnLo;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0',
      borderBottom: `1px dashed ${HF.border}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <P size={12} weight={600}>{l}</P>
        <P size={10} color={HF.ink3}>{src}</P>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{
          padding: '2px 6px', borderRadius: HF.r.sm,
          background: bg, color: tone,
          fontFamily: HF.body, fontWeight: 700, fontSize: 10,
        }}>{conf}%</span>
        <span style={{ fontFamily: HF.display, fontWeight: 800, fontSize: 14, minWidth: 70, textAlign: 'right' }}>
          {v}
        </span>
        {flag && (
          <button style={{
            padding: '4px 10px', borderRadius: HF.r.sm, border: 'none',
            background: HF.accent, color: HF.paper, cursor: 'pointer',
            fontFamily: HF.body, fontWeight: 700, fontSize: 11,
          }}>Review</button>
        )}
      </div>
    </div>
  );
}

window.V2CalcTapeReview = V2CalcTapeReview;
