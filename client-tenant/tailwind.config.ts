import type { Config } from 'tailwindcss';
import { HF } from './src/styles/tokens';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream:     HF.cream,
        paper:     HF.paper,
        paperHi:   HF.paperHi,
        border:    HF.border,
        borderHi:  HF.borderHi,
        ink:       HF.ink,
        ink2:      HF.ink2,
        ink3:      HF.ink3,
        ink4:      HF.ink4,
        accent:    HF.accent,
        accentHi:  HF.accentHi,
        accentLo:  HF.accentLo,
        accentInk: HF.accentInk,
        sage:      HF.sage,
        sageLo:    HF.sageLo,
        ok:        HF.ok,
        okLo:      HF.okLo,
        warn:      HF.warn,
        warnLo:    HF.warnLo,
        err:       HF.err,
        errLo:     HF.errLo,
      },
      fontFamily: {
        display: HF.display.split(',').map((s) => s.trim().replace(/^"|"$/g, '')),
        sans:    HF.body.split(',').map((s) => s.trim().replace(/^"|"$/g, '')),
        mono:    HF.mono.split(',').map((s) => s.trim().replace(/^"|"$/g, '')),
      },
      borderRadius: {
        sm:   `${HF.r.sm}px`,
        md:   `${HF.r.md}px`,
        lg:   `${HF.r.lg}px`,
        xl:   `${HF.r.xl}px`,
        pill: `${HF.r.pill}px`,
      },
      boxShadow: {
        xs: HF.shadow.xs,
        sm: HF.shadow.sm,
        md: HF.shadow.md,
        lg: HF.shadow.lg,
      },
    },
  },
  plugins: [],
} satisfies Config;
