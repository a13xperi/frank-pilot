import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Semantic brand scale aliased to emerald. New components reference
      // `brand-*` so the palette can be re-pointed in one place; existing
      // `emerald-*` usages are intentionally left as-is (no-churn migration).
      colors: {
        brand: colors.emerald,
      },
    },
  },
  plugins: [],
};
