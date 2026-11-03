import type { Config } from 'tailwindcss';
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { brand: { 50: '#eef4ff', 100: '#d9e5ff', 500: '#2f5fd0', 600: '#244bb0', 700: '#1c3a8a', 900: '#0f2152' } } } },
  plugins: [],
} satisfies Config;
