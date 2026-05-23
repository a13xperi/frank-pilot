// qaDrain — Playwright helper that captures the same debug bundle as the
// in-app camera button (PNG + qaBuffer + rrweb replay) and attaches it to
// the failing test's report.
//
// Why: the camera button works when a human is driving and can click. For
// Playwright-driven runs we want the same payload triggered automatically
// on any non-passing test. Local disk only — no Supabase upload.

import type { Page, TestInfo } from "@playwright/test";
import { promises as fs } from "node:fs";
import path from "node:path";

// Shape installed by client-tenant/src/main.tsx in DEV.
type WindowWithDrain = Window & {
  __qa_drain?: {
    getQaBuffer: () => unknown[];
    clearQaBuffer: () => void;
    getQaReplayEvents: () => unknown[];
    clearQaReplay: () => void;
    stopQaReplay: () => void;
    installQaReplay: () => Promise<void>;
    toPng?: (n: HTMLElement, o?: object) => Promise<string>;
  };
};

async function safeEvaluate<T>(page: Page, fn: () => T | Promise<T>): Promise<T | null> {
  try {
    if (page.isClosed()) return null;
    return await page.evaluate(fn);
  } catch {
    return null;
  }
}

async function writeAttachment(
  testInfo: TestInfo,
  basename: string,
  body: string | Buffer,
  contentType: string
): Promise<void> {
  await fs.mkdir(testInfo.outputDir, { recursive: true });
  const filePath = path.join(testInfo.outputDir, basename);
  await fs.writeFile(filePath, body);
  await testInfo.attach(basename, { path: filePath, contentType });
}

/**
 * Attach a debug bundle to a Playwright TestInfo. Safe to call on success
 * (no-op skipping the attachments) but typically wired via `test.afterEach`
 * with a status guard.
 */
export async function drainQaBundle(page: Page, testInfo: TestInfo): Promise<void> {
  if (page.isClosed()) return;

  // 1. qaBuffer (fetch + JS error log)
  const buffer = await safeEvaluate(page, () => {
    const w = window as unknown as WindowWithDrain;
    return w.__qa_drain ? w.__qa_drain.getQaBuffer() : null;
  });

  // 2. rrweb events — stop, snapshot, clear, re-install for next test
  const replayEvents = await safeEvaluate(page, async () => {
    const w = window as unknown as WindowWithDrain;
    if (!w.__qa_drain) return null;
    w.__qa_drain.stopQaReplay();
    const events = w.__qa_drain.getQaReplayEvents();
    w.__qa_drain.clearQaReplay();
    void w.__qa_drain.installQaReplay();
    return events;
  });

  // 3. PNG via html-to-image, mirroring ScreenshotButton (same
  //    data-screenshot-exclude rule). main.tsx eagerly binds `toPng` to
  //    `window.__qa_drain.toPng` in DEV so we never have to dynamic-import
  //    a bare specifier from the page context.
  const png = await safeEvaluate(page, async () => {
    const w = window as unknown as WindowWithDrain;
    if (!w.__qa_drain?.toPng) return null;
    try {
      return await w.__qa_drain.toPng(document.body, {
        cacheBust: true,
        backgroundColor: "#ffffff",
        skipFonts: true,
        filter: (n: Node) => {
          if (!(n instanceof Element)) return true;
          return n.getAttribute("data-screenshot-exclude") !== "1";
        },
      });
    } catch {
      return null;
    }
  });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const slug = testInfo.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase().slice(0, 60);
  const base = `frank-${slug}-${stamp}`;

  if (buffer) {
    await writeAttachment(
      testInfo,
      `${base}.json`,
      JSON.stringify(
        {
          test: testInfo.title,
          file: testInfo.file,
          status: testInfo.status,
          url: page.url(),
          buffer,
        },
        null,
        2
      ),
      "application/json"
    );
  }

  if (replayEvents && Array.isArray(replayEvents) && replayEvents.length > 0) {
    await writeAttachment(
      testInfo,
      `${base}.replay.json`,
      JSON.stringify(replayEvents),
      "application/json"
    );
  }

  if (png && typeof png === "string" && png.startsWith("data:image/png;base64,")) {
    const b64 = png.slice("data:image/png;base64,".length);
    await writeAttachment(testInfo, `${base}.png`, Buffer.from(b64, "base64"), "image/png");
  }
}
