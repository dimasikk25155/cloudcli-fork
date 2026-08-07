import defaultTheme from 'tailwindcss/defaultTheme';

// Плотность интерфейса: отступы едут от токена --density, который задаёт тема.
// Ключи шкалы остаются теми же, что у Tailwind, поэтому все существующие
// классы (p-4, gap-2, space-y-3) продолжают работать, а при --density: 1
// вычисленное значение совпадает с прежним до пикселя.
// Ширины, высоты и inset НЕ трогаем: размеры иконок и раскладка не должны
// ползти от плотности — за общий размер отвечает масштаб интерфейса.
const scaledByDensity = Object.fromEntries(
  Object.entries(defaultTheme.spacing).map(([key, value]) => [
    key,
    value === '0px' ? value : `calc(${value} * var(--density))`,
  ])
);

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      // Шрифты берём из токенов темы (см. :root в index.css) — стек живёт
      // в одном месте, тема подменяет его целиком.
      fontFamily: {
        sans: ['var(--font-ui)'],
        serif: ['var(--font-chat)'],
        mono: ['var(--font-mono)'],
      },
      // Отступы уважают плотность; margin сохраняет `auto` (mx-auto).
      padding: scaledByDensity,
      gap: scaledByDensity,
      space: scaledByDensity,
      margin: { auto: 'auto', ...scaledByDensity },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        // Статусы: успех / предупреждение / информация. Раньше жили хардкодом
        // (green-500, amber-500, blue-600) и не слушались темы.
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        info: {
          DEFAULT: "hsl(var(--info))",
          foreground: "hsl(var(--info-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Шкала темы под отдельными именами: встроенные rounded-xl/2xl не
        // трогаем, чтобы существующие экраны не поехали. На них переезжают
        // компоненты по мере миграции (Этап 3).
        'ui-sm': 'var(--radius-sm)',
        'ui-md': 'var(--radius-md)',
        'ui-lg': 'var(--radius-lg)',
        'ui-xl': 'var(--radius-xl)',
        'ui-2xl': 'var(--radius-2xl)',
      },
      // Тени темы отдельными именами по той же причине.
      boxShadow: {
        1: 'var(--shadow-1)',
        2: 'var(--shadow-2)',
        3: 'var(--shadow-3)',
      },
      transitionDuration: {
        fast: 'var(--duration-fast)',
        base: 'var(--duration-base)',
        slow: 'var(--duration-slow)',
      },
      transitionTimingFunction: {
        ui: 'var(--ease-ui)',
        'ui-inout': 'var(--ease-ui-inout)',
      },
      spacing: {
        'safe-area-inset-bottom': 'env(safe-area-inset-bottom)',
        'mobile-nav': 'var(--mobile-nav-total)',
      },
      keyframes: {
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'dialog-overlay-show': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'dialog-content-show': {
          from: { opacity: '0', transform: 'translate(-50%, -48%) scale(0.96)' },
          to: { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
      },
      animation: {
        shimmer: 'shimmer 2s linear infinite',
        'dialog-overlay-show': 'dialog-overlay-show 150ms ease-out',
        'dialog-content-show': 'dialog-content-show 150ms ease-out',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
}