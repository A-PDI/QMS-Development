/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        pdi: {
          navy:     '#1D2B4F',
          'navy-light': '#2A3F72',
          steel:    '#B8C4D8',
          frost:    '#E8EBF0',
          charcoal: '#595959',
          white:    '#FFFFFF',
          amber:    '#D4943A',
          'amber-light': '#F5DBA8',
          teal:     '#1A8C80',
          'teal-light': '#D0EFEC',
          red:      '#C0392B',
          'red-light': '#FDECEA',
          green:    '#1E7E4A',
          'green-light': '#D4EDDA',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
