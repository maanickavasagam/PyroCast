/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Near-black surfaces
        base: {
          950: '#08090c',
          900: '#0c0e13',
          850: '#11141b',
          800: '#161a23',
          700: '#1e2530',
          600: '#2a3340',
        },
        // Fire / danger scale
        fire: {
          50: '#fff4ed',
          400: '#ff8a4c',
          500: '#ff6b35',
          600: '#f0480e',
          700: '#c23608',
        },
        ember: '#ffb340',
        // Safe / informational
        teal: {
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      keyframes: {
        'pulse-ring': {
          '0%': { transform: 'scale(0.6)', opacity: '0.7' },
          '80%, 100%': { transform: 'scale(2.4)', opacity: '0' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2.4s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fade-in 260ms ease-out',
        'slide-up': 'slide-up 260ms ease-out',
      },
    },
  },
  plugins: [],
};
