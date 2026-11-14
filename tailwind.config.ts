import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

/**
 * AEGIS design tokens: dark navy spacecraft console with a restrained cyan accent.
 * Status colours (nominal / review / action / no-data) are always paired with
 * text and an icon in the UI (see StatusBadge); colour alone never carries meaning.
 * Foreground/background pairs below meet WCAG AA (>= 4.5:1) on the navy surfaces.
 */
const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem', screens: { '2xl': '1440px' } },
    extend: {
      colors: {
        // Navy surface ramp (950 = deepest).
        navy: {
          950: '#050a14',
          900: '#0a1324',
          850: '#0e1a30',
          800: '#13213b',
          700: '#1c2e4f',
          600: '#2a4068',
          500: '#3d5683',
        },
        surface: {
          DEFAULT: '#0a1324',
          raised: '#0e1a30',
          overlay: '#13213b',
          sunken: '#050a14',
          border: '#22355a',
        },
        ink: {
          DEFAULT: '#e6edf7', // primary text, ~15.6:1 on navy-900
          muted: '#a4b3cc', // secondary text, ~8.3:1 on navy-900
          subtle: '#8595b0', // tertiary text, ~5.7:1 on navy-900
        },
        accent: {
          DEFAULT: '#22c3dd', // restrained cyan, ~8.6:1 on navy-900
          strong: '#5ad8ec',
          muted: '#0f4c5c',
          foreground: '#041016',
        },
        status: {
          nominal: '#4ade80',
          'nominal-bg': '#0d2b1c',
          review: '#fbbf24',
          'review-bg': '#2e2309',
          action: '#f87171',
          'action-bg': '#33141a',
          nodata: '#a4b3cc',
          'nodata-bg': '#1a2640',
        },
        // shadcn/ui semantic tokens (CSS variables in src/index.css).
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        // Typography scale. `metric` sizes are for large measurement-card values.
        caption: ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.02em' }],
        label: ['0.8125rem', { lineHeight: '1.125rem', letterSpacing: '0.04em' }],
        body: ['0.9375rem', { lineHeight: '1.5rem' }],
        title: ['1.125rem', { lineHeight: '1.625rem', fontWeight: '600' }],
        heading: ['1.5rem', { lineHeight: '2rem', fontWeight: '600' }],
        display: ['2rem', { lineHeight: '2.5rem', fontWeight: '600' }],
        metric: ['2.5rem', { lineHeight: '1', fontWeight: '600', letterSpacing: '-0.01em' }],
        'metric-sm': ['1.75rem', { lineHeight: '1', fontWeight: '600' }],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      boxShadow: {
        console: '0 0 0 1px rgba(34, 195, 221, 0.08), 0 8px 24px -12px rgba(0, 0, 0, 0.6)',
      },
    },
  },
  plugins: [animate],
};

export default config;
