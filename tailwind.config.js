/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#0a0a0a',
          card: '#151515',
          hover: '#1a1a1a',
          input: '#1e1e1e',
          border: '#2a2a2a',
        },
        accent: {
          DEFAULT: '#10b981',
          hover: '#0f9b76',
          muted: '#0d7d5f',
        },
        gold: {
          DEFAULT: '#d4af37',
          hover: '#c19b2f',
          muted: '#a8861f',
        },
      },
      fontFamily: {
        sans: ['Cairo', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
