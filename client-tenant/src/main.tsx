import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './i18n';
import { installQaBuffer, getQaBuffer, clearQaBuffer } from './lib/qaBuffer';
import {
  installQaReplay,
  getQaReplayEvents,
  clearQaReplay,
  stopQaReplay,
} from './lib/qaSessionReplay';
import { initDemoSession } from './lib/demoSession';

installQaBuffer();

// Capture `?demo=<TOKEN>` before React mounts: stashes the token + mints a
// runId, and scrubs the param from the address bar so an account-takeover-
// grade link can't be copied out of a tester's URL. No-op without `?demo=`.
initDemoSession();

// DEV-only window shim — lets the Playwright harness (e2e/qaDrain.ts) read
// the same buffers the in-app camera button uses, without dynamic-importing
// /src/lib/* paths (which works in dev but breaks once Vite bundles).
if (import.meta.env.DEV) {
  void installQaReplay();
  // Eagerly bind html-to-image's toPng so qaDrain doesn't need to dynamic-
  // import a bare specifier from the page context (vite resolves bare deps
  // only when the import appears in the bundle graph).
  void import('html-to-image').then((mod) => {
    (window as unknown as { __qa_drain?: Record<string, unknown> }).__qa_drain = {
      ...((window as unknown as { __qa_drain?: Record<string, unknown> }).__qa_drain ?? {}),
      toPng: mod.toPng,
    };
  });
  (window as unknown as { __qa_drain?: unknown }).__qa_drain = {
    getQaBuffer,
    clearQaBuffer,
    getQaReplayEvents,
    clearQaReplay,
    stopQaReplay,
    installQaReplay,
  };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
