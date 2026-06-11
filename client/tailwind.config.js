import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */

// Every color family the app uses resolves through CSS variables defined in
// src/index.css, so dark mode is a single `.dark` variable swap — component
// classes like `bg-white` / `text-gray-900` / `bg-red-50` need no `dark:`
// variants. Add a family here AND in index.css if you introduce a new one.
const LEVELS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const varScale = (name) =>
  Object.fromEntries(
    LEVELS.map((l) => [l, `rgb(var(--c-${name}-${l}) / <alpha-value>)`])
  );
const pick = (scale, levels) =>
  Object.fromEntries(levels.map((l) => [l, scale[l]]));

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // Refined system stack — SF Pro on macOS, Segoe UI Variable on
        // Windows. No webfont request, no FOUT, native rendering everywhere.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"SF Pro Text"',
          '"Segoe UI Variable"',
          '"Segoe UI"',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          '"SF Mono"',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      fontSize: {
        // Data-UI scale: 11px micro-labels (table headers, eyebrows) and a
        // 13px body for dense tables/forms. Both ship a comfortable leading.
        '2xs': ['0.6875rem', { lineHeight: '1rem', letterSpacing: '0.05em' }],
        '13': ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      boxShadow: {
        // Layered, low-alpha shadows — pair with hairline borders so cards
        // read as surfaces in light mode without flat gray outlines.
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.05)',
        'card-hover':
          '0 1px 2px 0 rgb(16 24 40 / 0.05), 0 4px 12px -2px rgb(16 24 40 / 0.08)',
        pop: '0 1px 2px 0 rgb(16 24 40 / 0.06), 0 12px 32px -8px rgb(16 24 40 / 0.18)',
        'btn-primary':
          'inset 0 1px 0 0 rgb(255 255 255 / 0.12), 0 1px 2px 0 rgb(4 120 87 / 0.25)',
      },
      colors: {
        white: 'rgb(var(--c-white) / <alpha-value>)',
        gray: varScale('gray'),
        emerald: varScale('emerald'),
        red: varScale('red'),
        green: varScale('green'),
        amber: varScale('amber'),
        blue: varScale('blue'),
        yellow: varScale('yellow'),
        purple: varScale('purple'),
        orange: varScale('orange'),
        sky: varScale('sky'),
        indigo: varScale('indigo'),
        // Semantic brand scale aliased to emerald. New components reference
        // `brand-*` so the palette can be re-pointed in one place; existing
        // `emerald-*` usages are intentionally left as-is (no-churn migration).
        brand: varScale('emerald'),
      },
      // Solid action fills (always paired with `text-white`) keep their deep
      // shade in BOTH themes — only the background pins; text/border/ring at
      // these same levels still flip via the vars so badge text stays legible.
      backgroundColor: {
        emerald: pick(colors.emerald, [500, 600, 700]),
        brand: pick(colors.emerald, [500, 600, 700]),
        red: pick(colors.red, [600, 700]),
        blue: pick(colors.blue, [600, 700]),
        amber: pick(colors.amber, [600, 700]),
      },
      // `text-white` only ever sits on those solid fills, so it never flips.
      textColor: { white: '#ffffff' },
    },
  },
  plugins: [],
};
