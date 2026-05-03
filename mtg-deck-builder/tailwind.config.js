/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        mtg: {
          black: '#0D0D0D',
          dark: '#1A1A2E',
          panel: '#16213E',
          border: '#2A2A4A',
          gold: '#C9A84C',
          white: '#F8F4E3',
          blue: '#3B82F6',
          red: '#EF4444',
          green: '#22C55E',
          swamp: '#1a0a2e',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
