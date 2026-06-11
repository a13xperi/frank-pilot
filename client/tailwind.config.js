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
      // MODERN OPS: sharp 6px radii everywhere. Existing components use
      // rounded-lg / rounded-xl; remapping the tokens sharpens the whole app
      // without touching every call site. (rounded-full is untouched.)
      borderRadius: {
        lg: '0.375rem',
        xl: '0.375rem',
        '2xl': '0.5rem',
      },
      fontFamily: {
        // Serious-infrastructure system stacks — SF Pro / SF Mono on macOS.
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          '"Helvetica Neue"',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          '"SF Mono"',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          '"Liberation Mono"',
          'monospace',
        ],
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
