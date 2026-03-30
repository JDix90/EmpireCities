/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // ChronoConquest brand palette
        'cc-gold':    '#c9a84c',
        'cc-dark':    '#0f1117',
        'cc-surface': '#1a1f2e',
        'cc-border':  '#2d3448',
        'cc-text':    '#e8e8e8',
        'cc-muted':   '#8892a4',
      },
      fontFamily: {
        display: ['"Cinzel"', 'serif'],
        body:    ['"Inter"', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in':    'fadeIn 0.3s ease-in-out',
        'modal-in':   'modalIn 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
        'modal-backdrop': 'backdropIn 0.25s ease-out',
        'notif-in':   'notifIn 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'notif-out':  'notifOut 0.3s ease-in forwards',
        'dice-settle': 'diceSettle 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        'capture-glow': 'captureGlow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        modalIn: {
          '0%':   { opacity: '0', transform: 'scale(0.9) translateY(20px)' },
          '100%': { opacity: '1', transform: 'scale(1) translateY(0)' },
        },
        backdropIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        notifIn: {
          '0%':   { opacity: '0', transform: 'translateX(-50%) translateY(-20px) scale(0.95)' },
          '100%': { opacity: '1', transform: 'translateX(-50%) translateY(0) scale(1)' },
        },
        notifOut: {
          '0%':   { opacity: '1', transform: 'translateX(-50%) translateY(0)' },
          '100%': { opacity: '0', transform: 'translateX(-50%) translateY(-12px)' },
        },
        diceSettle: {
          '0%':   { transform: 'scale(0.8) rotate(-10deg)' },
          '50%':  { transform: 'scale(1.15) rotate(3deg)' },
          '100%': { transform: 'scale(1.1) rotate(0deg)' },
        },
        captureGlow: {
          '0%, 100%': { boxShadow: '0 0 20px rgba(234, 179, 8, 0.3)' },
          '50%':      { boxShadow: '0 0 40px rgba(234, 179, 8, 0.6)' },
        },
      },
    },
  },
  plugins: [],
};
