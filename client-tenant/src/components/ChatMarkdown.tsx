/**
 * ChatMarkdown — XSS-safe markdown renderer for assistant chat bubbles.
 *
 * The housing-QA system prompt instructs the model to format answers in a
 * limited markdown subset (**bold**, `- lists`, `## headings`, `[links](url)`,
 * `inline code`). The widget previously rendered the raw answer string, so those
 * markers showed literally (issue #223). This renders them.
 *
 * The text is MODEL-GENERATED → untrusted. Two layers of defense:
 *   1. react-markdown does NOT parse raw HTML (no rehype-raw plugin), so any
 *      literal `<script>` / `<img onerror=…>` in the answer is escaped to inert
 *      text, never a DOM element.
 *   2. rehype-sanitize drops every tag outside the allowlist below and strips
 *      any href whose protocol isn't http/https/mailto/tel (so `javascript:`
 *      links lose their href).
 *
 * Assistant bubbles only — user input stays plain text in the widget.
 */
import type { CSSProperties } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import { HF } from '@/styles/tokens';

// Structural allowlist = the subset the prompt emits. Headings collapse to a
// compact styled block; everything not listed (images, iframes, raw HTML, h4+)
// is removed by the sanitizer while keeping its inner text. `href` protocols
// inherit the sanitizer default, which already excludes `javascript:`.
const schema = {
  ...defaultSchema,
  tagNames: [
    'p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'a', 'code', 'pre',
  ],
  attributes: {
    ...defaultSchema.attributes,
    a: [...(defaultSchema.attributes?.a ?? []), 'href'],
  },
};

const heading: CSSProperties = {
  fontFamily: HF.display,
  fontWeight: 700,
  color: HF.ink,
  fontSize: 14,
  margin: '8px 0 4px',
  lineHeight: 1.3,
};

const components: Components = {
  // Tighten default block spacing for the small bubble.
  p: ({ children }) => <p style={{ margin: '0 0 6px' }}>{children}</p>,
  h1: ({ children }) => <div style={heading}>{children}</div>,
  h2: ({ children }) => <div style={heading}>{children}</div>,
  h3: ({ children }) => <div style={{ ...heading, fontSize: 13.5 }}>{children}</div>,
  ul: ({ children }) => <ul style={{ margin: '4px 0 6px', paddingLeft: 18 }}>{children}</ul>,
  ol: ({ children }) => <ol style={{ margin: '4px 0 6px', paddingLeft: 18 }}>{children}</ol>,
  li: ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
  code: ({ children }) => (
    <code
      style={{
        fontFamily: HF.mono,
        fontSize: 12,
        background: HF.cream,
        padding: '1px 4px',
        borderRadius: 4,
      }}
    >
      {children}
    </code>
  ),
  // target/rel are hardcoded at render (not sourced from the model); a
  // sanitizer-rejected protocol leaves href undefined → inert anchor.
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: HF.accent, textDecoration: 'underline' }}
    >
      {children}
    </a>
  ),
};

export function ChatMarkdown({ text }: { text: string }) {
  return (
    <ReactMarkdown rehypePlugins={[[rehypeSanitize, schema]]} components={components}>
      {text}
    </ReactMarkdown>
  );
}

export default ChatMarkdown;
