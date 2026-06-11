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

// Warm-community pinned action fills: a warmer leaf green for primary actions,
// terracotta-leaning red/amber kept at stock depths for semantic clarity.
const WARM_GREEN = { 500: '#6d983f', 600: '#557c2d', 700: '#436225' };

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
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
        emerald: WARM_GREEN,
        brand: WARM_GREEN,
        red: { 600: '#dc2626', 700: '#b91c1c' },
        blue: { 600: '#2563eb', 700: '#1d4ed8' },
        amber: { 600: '#d97706', 700: '#b45309' },
      },
      // `text-white` only ever sits on those solid fills, so it never flips.
      textColor: { white: '#ffffff' },
      fontFamily: {
        sans: [
          '"Nunito Sans"',
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          '"Segoe UI"',
          'sans-serif',
        ],
        display: ['Fraunces', 'Georgia', 'ui-serif', 'serif'],
      },
      // Slightly larger, friendlier body text (most copy sits at sm/xs).
      fontSize: {
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],
        sm: ['0.9375rem', { lineHeight: '1.4rem' }],
      },
      // Softer geometry: existing rounded-md/lg/xl call sites get gentler
      // radii without touching each component.
      borderRadius: {
        DEFAULT: '0.5rem',
        md: '0.625rem',
        lg: '0.75rem',
        xl: '1rem',
      },
      // Warm, diffuse shadows (brown-tinted, never harsh).
      boxShadow: {
        sm: '0 1px 2px 0 rgb(68 50 35 / 0.05), 0 2px 6px -2px rgb(68 50 35 / 0.07)',
        md: '0 4px 12px -2px rgb(68 50 35 / 0.08), 0 2px 4px -2px rgb(68 50 35 / 0.05)',
        lg: '0 14px 36px -10px rgb(68 50 35 / 0.16), 0 4px 10px -4px rgb(68 50 35 / 0.07)',
        xl: '0 24px 56px -16px rgb(68 50 35 / 0.22), 0 6px 16px -6px rgb(68 50 35 / 0.08)',
      },
    },
  },
  plugins: [],
};
