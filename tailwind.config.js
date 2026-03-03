/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0f172a',
        mist: '#e2e8f0',
        mint: '#10b981',
        amber: '#f59e0b',
        danger: '#ef4444'
      }
    }
  },
  plugins: []
};
