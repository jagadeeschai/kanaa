/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Graphite neutrals: no color cast, so photos read true against the interface.
        slate: {
          50: '#f6f6f5',
          100: '#ecebe9',
          200: '#d9d8d5',
          300: '#b9b7b3',
          400: '#94928d',
          500: '#75736e',
          600: '#5a5854',
          700: '#43423f',
          800: '#2e2d2b',
          900: '#222120',
          950: '#1a1a19'
        },
        brand: {
          50: '#fff8eb',
          100: '#fdecc8',
          200: '#fbd78c',
          300: '#f6bd55',
          400: '#eea52e',
          500: '#dc8a14',
          600: '#b96b0e',
          700: '#935110',
          800: '#774114',
          900: '#633715',
          950: '#391c07'
        }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(148,146,141,0.12), 0 20px 60px rgba(0,0,0,0.45)'
      },
      backgroundImage: {
        'radial-soft': 'radial-gradient(circle at top, rgba(238,165,46,0.05), transparent 40%)'
      }
    }
  },
  plugins: []
};
