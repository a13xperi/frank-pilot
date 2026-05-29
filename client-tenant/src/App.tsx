import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard } from '@/components/AuthGuard';
import { Layout } from '@/components/Layout';
import { Login } from '@/pages/Login';
import { Apply } from '@/pages/Apply';
import { AuthCallback } from '@/pages/AuthCallback';
import { VerifyPending } from '@/pages/VerifyPending';
import { Dashboard } from '@/pages/Dashboard';
import { Pay } from '@/pages/Pay';
import { Ledger } from '@/pages/Ledger';
import { Maintenance } from '@/pages/Maintenance';
import { Status } from '@/pages/Status';
import { Lease } from '@/pages/Lease';
import { Settings } from '@/pages/Settings';
import { Application } from '@/pages/Application';
import { WelcomeShell } from '@/pages/welcome/WelcomeShell';
import { PropertyList } from '@/pages/discover/PropertyList';
import { PropertyDetail } from '@/pages/discover/PropertyDetail';
import { CityLanding } from '@/pages/discover/CityLanding';
import { Shortlist } from '@/pages/saved/Shortlist';
import { WaitlistPosition } from '@/pages/waitlist/Position';
import { WaitlistFasterList } from '@/pages/waitlist/FasterList';
import { MagicLinkSent } from '@/pages/apply/MagicLinkSent';
import { ScreenshotButton } from '@/components/dev/ScreenshotButton';
import { DemoStuckButton } from '@/components/dev/DemoStuckButton';
import { DemoOverlay } from '@/components/DemoOverlay';
import { HousingChatWidget } from '@/components/HousingChatWidget';
import { TalkToFrankPill } from '@/components/TalkToFrankPill';
import { CookieBanner } from '@/components/CookieBanner';
import { SiteFooter } from '@/components/SiteFooter';
import { PrivacyPolicy } from '@/pages/legal/PrivacyPolicy';
import { CookiesPolicy } from '@/pages/legal/CookiesPolicy';
import { getToken } from '@/api/client';
import { initAnalytics, watchConsentAndInit } from '@/lib/analytics';

function RootRedirect() {
  return <Navigate to={getToken() ? '/dashboard' : '/login'} replace />;
}

export default function App() {
  // gpmglv wedge #15 — gate analytics on consent.
  // Run once on mount (covers users who already accepted before this load),
  // then subscribe so a user who accepts mid-session gets tracked without a
  // reload.
  useEffect(() => {
    initAnalytics();
    const unsubscribe = watchConsentAndInit();
    return unsubscribe;
  }, []);

  return (
    <>
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<Login />} />
      <Route path="/welcome" element={<WelcomeShell />} />
      <Route path="/apply" element={<Apply />} />
      <Route path="/apply/magic-link-sent" element={<MagicLinkSent />} />
      <Route path="/discover" element={<PropertyList />} />
      {/* discover wedge — city-named SEO landing pages (one per GPMG city) */}
      <Route path="/discover/city/:city" element={<CityLanding />} />
      <Route path="/property/:slug" element={<PropertyDetail />} />
      {/* feat/saved-shortlist — guest wishlist; public, NOT behind AuthGuard */}
      <Route path="/saved" element={<Shortlist />} />
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/verify-pending" element={<VerifyPending />} />

      {/* gpmglv wedge #15 — public legal pages, no auth gate */}
      <Route path="/privacy" element={<PrivacyPolicy />} />
      <Route path="/cookies" element={<CookiesPolicy />} />

      {/* BP-03b — waitlist screens (public; carrot pulls applicant back into flow) */}
      <Route path="/waitlist/position" element={<WaitlistPosition />} />
      <Route path="/waitlist/position/:slug" element={<WaitlistPosition />} />
      <Route path="/waitlist/faster-list" element={<WaitlistFasterList />} />

      <Route element={<AuthGuard />}>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/application" element={<Application />} />
          <Route path="/pay" element={<Pay />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/status" element={<Status />} />
          <Route path="/lease" element={<Lease />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    <SiteFooter />
    <CookieBanner />
    <ScreenshotButton />
    <DemoStuckButton />
    <DemoOverlay />
    <HousingChatWidget />
    <TalkToFrankPill />
    </>
  );
}
