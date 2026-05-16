// V2 Hi-Fi · main canvas — assembles all v2 screens onto the design canvas
// so they read like a connected Zillow-style flow. Mobile leads, desktop
// shows alongside where it adds value.

function V2App() {
  return (
    <>
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 5,
        background: 'rgba(251, 247, 240, 0.92)', backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${HF.border}`,
        padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 16,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: HF.r.sm,
          background: HF.accent, color: HF.paper,
          display: 'grid', placeItems: 'center', fontFamily: HF.display, fontWeight: 800, fontSize: 13,
        }}>U</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: HF.display, fontSize: 16, fontWeight: 700, color: HF.ink, letterSpacing: '-0.01em' }}>
            Universal Housing · Hi-fi v2
          </div>
          <div style={{ fontFamily: HF.body, fontSize: 11, color: HF.ink3 }}>
            Affordable housing, Zillow-grade. Built on GPMGLV's 16-community portfolio.
          </div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <span style={{
            fontFamily: HF.body, fontSize: 11, color: HF.ink3,
            padding: '4px 10px', borderRadius: HF.r.pill,
            border: `1px dashed ${HF.borderHi}`,
          }}>
            Building order: Browse → Detail → Apply → Pay → Dashboard
          </span>
        </div>
      </div>
      <div style={{ height: 56 }} />

      <DesignCanvas>
        <DCSection
          id="v2-discover"
          title="Discovery"
          subtitle="The Zillow-style entry into affordable housing. Mobile-first; desktop alongside for comparison."
        >
          <DCArtboard id="v2-browse-mobile" label="Mobile · browse 16 communities"
                      width={420} height={1920}>
            <div style={{
              width: '100%', height: '100%', display: 'grid', placeItems: 'center',
              background: HF.cream, paddingTop: 12,
            }}>
              <V2BrowseMobile />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-detail-mobile" label="Mobile · property detail · Juan Garcia"
                      width={420} height={1820}>
            <div style={{
              width: '100%', height: '100%', display: 'grid', placeItems: 'center',
              background: HF.cream, paddingTop: 12,
            }}>
              <V2PropertyDetail />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-browse-desktop" label="Desktop · browse (comparison view)"
                      width={1280} height={1100}>
            <div style={{
              width: '100%', height: '100%', overflow: 'hidden', background: HF.cream,
            }}>
              <V2Browse />
            </div>
          </DCArtboard>
        </DCSection>

        <DCSection
          id="v2-apply"
          title="Apply"
          subtitle="The 5-screen path from “Apply” tap → waitlist confirmation. Real Juan Garcia data, real fee math, dual-gateway payment."
        >
          {[
            { id: 'v2-apply-1', label: 'Apply 1 · Review',     Comp: V2Review,     h: 1720 },
            { id: 'v2-apply-2', label: 'Apply 2 · Household',  Comp: V2Household,  h: 1520 },
            { id: 'v2-apply-3', label: 'Apply 3 · Payment',    Comp: V2Payment,    h: 1720 },
            { id: 'v2-apply-4', label: 'Apply 4 · Details',    Comp: V2Details,    h: 1920 },
            { id: 'v2-apply-5', label: 'Apply 5 · Confirm',    Comp: V2Confirm,    h: 1720 },
          ].map(({ id, label, Comp, h }) => (
            <DCArtboard key={id} id={id} label={label} width={420} height={h}>
              <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
                <Comp />
              </div>
            </DCArtboard>
          ))}
        </DCSection>

        <DCSection
          id="v2-trust"
          title="Trust & transparency"
          subtitle="Brand-defining screens. Plain-language rent explainer + the PM side-by-side calc-tape review (C2.9 + C2.8)."
        >
          <DCArtboard id="v2-rent-faq" label="Mobile · How is my rent calculated?"
                      width={420} height={2420}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2RentFAQ />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-calc-tape" label="Desktop · PM calc-tape side-by-side review"
                      width={1440} height={1100}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2CalcTapeReview />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-applicant"
          title="Active applicant phase"
          subtitle="What Marisol sees during 30+ days on the waitlist, then once Frank picks up her file. The PropertyAnchor strip is pinned across every screen — same trap, more days."
        >
          <DCArtboard id="v2-wl-dash" label="Day 31 · Waitlist · climbing to #1"
                      width={420} height={2220}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2WaitlistDashboard />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-proc-dash" label="Day 67 · PM review · 5-stage tracker"
                      width={420} height={2020}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2ProcessingDashboard />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-docs" label="Documents · all 5 verified"
                      width={420} height={1520}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2DocumentsFeed />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-inbox" label="Inbox · 1 unread from Frank"
                      width={420} height={1720}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Inbox />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-movein"
          title="Move-in transition"
          subtitle="Day 74 → 89 · the applicant-to-tenant handoff. Lease sign → PM walkthrough → utilities → keys."
        >
          <DCArtboard id="v2-mi-lease" label="Day 74 · Lease sign (DocuSign)"
                      width={420} height={2220}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2LeaseSign />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-mi-walk" label="Day 75 · PM walkthrough scheduled"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Walkthrough />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-mi-util" label="Day 80 · Gas + electric activation"
                      width={420} height={1720}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Utilities />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-mi-keys" label="Day 89 · Keys & celebration"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Keys />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-tenant"
          title="Tenant lifecycle"
          subtitle="Daily-use screens. Real Juan Garcia data, real NV compliance (NRS 40.253 Pay-or-Quit, $50+$10/day late fees, 120/90/60 recert)."
        >
          <DCArtboard id="v2-t-home" label="Tenant home · Day 90"
                      width={420} height={2120}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2TenantHome />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-t-pay" label="Pay rent · monthly"
                      width={420} height={1720}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2PayRent />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-t-grace" label="Late · grace period (day 3)"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2LateGrace />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-t-paq" label="7-Day Pay-or-Quit · NRS 40.253"
                      width={420} height={2020}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2LatePayOrQuit />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-t-maint" label="Maintenance · work order submitted"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Maintenance />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-t-recert" label="Annual recert + renewal (combined)"
                      width={420} height={1820}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Recert />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-moveout"
          title="Move-out"
          subtitle="End-of-relationship flow. 30-day notice → checklist → walkthrough + 21-day deposit (NRS 118A.242)."
        >
          <DCArtboard id="v2-mo-intent" label="Move-out · declare 30-day intent"
                      width={420} height={2020}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2MoveOutIntent />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-mo-list" label="Move-out · checklist · 24d left"
                      width={420} height={2220}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2MoveOutChecklist />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-mo-deposit" label="Walkthrough done · 21-day deposit"
                      width={420} height={2120}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2MoveOutDeposit />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-am"
          title="Asset Manager portal"
          subtitle="Desktop · the layer above PMs. Portfolio rollup, one-click audit packs, HUD auto-update engine."
        >
          <DCArtboard id="v2-am-portfolio" label="AM · Portfolio dashboard"
                      width={1440} height={1100}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2AMPortfolio />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-am-audit" label="AM · One-click audit packs"
                      width={1440} height={1500}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2AMAudit />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-am-hud" label="AM · HUD auto-update engine"
                      width={1440} height={1600}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2AMHud />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-polish"
          title="Cross-cutting polish"
          subtitle="Bilingual EN/ES · accessibility · AI chat · first-time onboarding tour. These are the surface-area patterns the rest of the app inherits."
        >
          <DCArtboard id="v2-p-es" label="Tenant home · Spanish (ES) variant"
                      width={420} height={2120}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2TenantHomeES />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-p-a11y" label="Accessibility · voice + Section 508"
                      width={420} height={1820}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Accessibility />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-p-chat" label="AI chat assistant · account-aware"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2ChatAssistant />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-p-tour" label="First-time tour · day 90"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2OnboardingTour />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-referral"
          title="Government Agency Referral (G9.5)"
          subtitle="The deep-link experience when an agency (SNHSP, VA, NV State) sends an applicant straight in. Pre-qualified, priority placement, agency caseworker pinned."
        >
          <DCArtboard id="v2-r-landing" label="Referral landing · SNHSP deep-link"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2ReferralLanding />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-account"
          title="Notifications + Account hub"
          subtitle="The 'I'm in control' surface area — notification feed, per-category preferences, account + payment methods (debit + ACH only)."
        >
          <DCArtboard id="v2-acct-feed" label="Notifications feed · 2 unread"
                      width={420} height={2020}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2NotificationFeed />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-acct-prefs" label="Notification preferences · category × channel"
                      width={420} height={2120}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2NotificationPrefs />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-acct-profile" label="Account · profile + household + payment"
                      width={420} height={2220}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Account />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-print"
          title="Print artifacts · audit-grade documents"
          subtitle="The PDF-style records the system produces. Tenant-downloadable, AM-bundleable into audit packs. 8.5×11 letter, full letterhead, signature lines."
        >
          <DCArtboard id="v2-pr-lease" label="Lease PDF · auto-populated"
                      width={860} height={1100}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2LeasePDF />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-pr-receipt" label="Application fee receipt"
                      width={860} height={1100}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2FeeReceipt />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-pr-calc" label="Calc-tape audit trail · HUD-50059"
                      width={860} height={1100}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2CalcAuditTrail />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-pr-deposit" label="Deposit disposition · NRS 118A.242"
                      width={860} height={1100}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2DepositStatement />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-edge"
          title="Empty · error · edge states"
          subtitle="The states Marisol might actually encounter. Calm, useful, never apologetic — first-time empty, all-portfolio waitlisted, denied application, declined payment, no-data tabs, offline."
        >
          <DCArtboard id="v2-e-empty" label="First-time saved · no shortlist"
                      width={420} height={1720}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2EmptyShortlist />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-e-full" label="All 16 communities waitlisted"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2AllFull />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-e-denied" label="Application denied · refund pending"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2AppDenied />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-e-declined" label="Payment declined · retry options"
                      width={420} height={1720}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2PaymentDeclined />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-e-empty-tabs" label="No-data states · empty tabs"
                      width={420} height={1920}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2NoData />
            </div>
          </DCArtboard>

          <DCArtboard id="v2-e-offline" label="Offline · cached + graceful"
                      width={420} height={1720}>
            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: HF.cream, paddingTop: 12 }}>
              <V2Offline />
            </div>
          </DCArtboard>
        </DCSection>
        <DCSection
          id="v2-eviction"
          title="PM Eviction Forms Library (G4.7)"
          subtitle="Cross-over from PM portal · all 13 NV landlord notices + 6 summary filings + 5 formal forms. Context-sensitive, jurisdiction-aware, LIHTC good-cause filter, VAWA pre-checked."
        >
          <DCArtboard id="v2-ef-lib" label="PM · Eviction Forms Library"
                      width={1440} height={1500}>
            <div style={{ width: '100%', height: '100%', overflow: 'auto', background: HF.cream }}>
              <V2EvictionForms />
            </div>
          </DCArtboard>
        </DCSection>
      </DesignCanvas>
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<V2App />);
