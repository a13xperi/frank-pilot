/**
 * CoBrowseViewer — the resident's read-only "watch-along" page (Phase 2).
 *
 * Opened from the SMS magic link (`/cobrowse/:id?vt=<viewerToken>`). Connects to
 * the screencast WebSocket and renders the frames of Frank (an Opus computer-use
 * agent) filling the real /apply form, live. It is strictly READ-ONLY: there is
 * no input channel back into the agent's browser — the resident watches and
 * confirms by voice on the call. Submit / identity / e-signature are NOT here;
 * the resident does those themselves afterward.
 *
 * Backend (built dark in src/modules/cobrowse/): GET /api/cobrowse/:id/view
 * (session meta) + the WS stream at /api/cobrowse/:id/stream. Route registration
 * in the tenant router is a follow-up.
 */
import { useEffect, useRef, useState } from "react";

type StreamMsg =
  | { type: "frame"; jpegB64: string }
  | { type: "field"; label: string }
  | { type: "state"; state: string }
  | { type: "done" };

function useQueryToken(): string {
  if (typeof window === "undefined") return "";
  // Token param is `vt` — must match the link minted by start-cobrowse.ts
  // (buildViewerLink) and the backend routes (GET /view, POST /step).
  return new URLSearchParams(window.location.search).get("vt") ?? "";
}

function sessionIdFromPath(): string {
  if (typeof window === "undefined") return "";
  const m = window.location.pathname.match(/cobrowse\/([^/?]+)/);
  return m ? m[1] : "";
}

export default function CoBrowseViewer(): JSX.Element {
  const id = sessionIdFromPath();
  const token = useQueryToken();
  const [status, setStatus] = useState<"connecting" | "watching" | "done" | "error">("connecting");
  const [caption, setCaption] = useState<string>("Getting things ready…");
  const imgRef = useRef<HTMLImageElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!id || !token) {
      setStatus("error");
      setCaption("This link is missing or expired. Ask Frank to text you a fresh one.");
      return;
    }
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    // Tenant proxies /api to the API host (same-origin Vercel rewrite).
    const url = `${proto}://${window.location.host}/api/cobrowse/${encodeURIComponent(id)}/stream?vt=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setStatus("watching");
    ws.onerror = () => setStatus("error");
    ws.onclose = () => setStatus((s) => (s === "done" ? "done" : "error"));
    ws.onmessage = (ev) => {
      let msg: StreamMsg;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      if (msg.type === "frame" && imgRef.current) {
        imgRef.current.src = `data:image/jpeg;base64,${msg.jpegB64}`;
      } else if (msg.type === "field") {
        setCaption(`Now entering: ${msg.label}`);
      } else if (msg.type === "state") {
        if (msg.state === "awaiting_confirm") setCaption("All set — Frank will ask you to confirm on the call.");
      } else if (msg.type === "done") {
        setStatus("done");
        setCaption("Done! You'll review and sign it yourself before anything is submitted.");
      }
    };
    return () => ws.close();
  }, [id, token]);

  function stop(): void {
    wsRef.current?.close();
    // Best-effort abort; the session also dies on TTL/idle server-side.
    void fetch(`/api/cobrowse/${encodeURIComponent(id)}/abort?vt=${encodeURIComponent(token)}`, { method: "POST" });
    setStatus("done");
    setCaption("Stopped. No worries — call us back anytime and we'll pick up where we left off.");
  }

  return (
    <div style={{ maxWidth: 520, margin: "0 auto", padding: 16, fontFamily: "system-ui, sans-serif" }}>
      <h2 style={{ fontSize: 18, marginBottom: 4 }}>Frank is filling this out with you</h2>
      <p style={{ fontSize: 13, color: "#555", marginTop: 0 }}>
        Watch along — <strong>this is a preview</strong>. You'll review it and sign it yourself
        before anything is submitted. Nothing is sent on your behalf.
      </p>

      <div style={{ position: "relative", border: "1px solid #ddd", borderRadius: 12, overflow: "hidden", background: "#fafafa", minHeight: 360 }}>
        <img ref={imgRef} alt="Live form" style={{ width: "100%", display: "block" }} />
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: "8px 12px", background: "rgba(0,0,0,0.6)", color: "#fff", fontSize: 13 }}>
          {status === "connecting" && "Connecting…"}
          {status === "watching" && caption}
          {status === "done" && caption}
          {status === "error" && caption}
        </div>
      </div>

      <button
        onClick={stop}
        disabled={status === "done"}
        style={{ marginTop: 12, width: "100%", padding: "12px 16px", borderRadius: 10, border: "1px solid #c33", background: "#fff", color: "#c33", fontSize: 15, fontWeight: 600 }}
      >
        Stop
      </button>
    </div>
  );
}
