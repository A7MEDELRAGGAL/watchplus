import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8eb6ff',
          400: '#598eff',
          500: '#3366ff',
          600: '#1d40f5',
          700: '#172fe1',
          800: '#1928b6',
          900: '#1a298f',
          950: '#0d1645',
        },
        ink: {
          50: '#f6f7f9',
          100: '#eceef2',
          200: '#d5dae3',
          300: '#b1bacb',
          400: '#8695ae',
          500: '#677795',
          600: '#525f7c',
          700: '#434d64',
          800: '#3a4253',
          900: '#343a47',
          950: '#23262e',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        arabic: ['var(--font-arabic)', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'scale(.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-in': 'fade-in .4s ease-out both',
        'fade-up': 'fade-up .4s ease-out both',
        'scale-in': 'scale-in .18s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
      },
      boxShadow: {
        card: '0 1px 2px rgb(16 24 40 / .06), 0 8px 24px -12px rgb(16 24 40 / .18)',
        'card-hover': '0 2px 4px rgb(16 24 40 / .08), 0 24px 48px -16px rgb(16 24 40 / .28)',
      },
    },
  },
  plugins: [],
};

export default config;
