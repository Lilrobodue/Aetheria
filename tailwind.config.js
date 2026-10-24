/** @type {import('tailwindcss').Config} */
// v15.3 style foundation. Keeps every v15.2.1 value: gold 400/500/600, deep 900/950, the Inter / Merriweather
// stacks and the two slow animations. Everything else is additive, under names no class used before v15.3,
// except gold 50-300 and 700-950: classes that name them (text-gold-200, to-gold-900/20, ...) rendered with
// no colour until now and show their intended tint from v15.3. The classic layout uses none of the other
// tokens yet; the v15.4 UI kit will. src/index.css mirrors these values as --ae-* variables
// (e2e/tests/style.spec.ts keeps the two equal).
//
// Class names must be complete literals in a scanned file (a ternary of two literals, or a static map), never
// built from strings: since v15.3 nothing generates CSS in the browser, so a class the build doesn't see has no
// style. e2e/tests/style.spec.ts fails on any class in the DOM without a rule.
export default {
  content: [
    './index.html',
    './App.tsx',
    './index.tsx',
    './constants.ts',
    './src/**/*.{js,ts,jsx,tsx}',
    './components/**/*.{js,ts,jsx,tsx}',
    './hooks/**/*.{js,ts,jsx,tsx}',
    './utils/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Tailwind's amber scale: 400/500/600 are the v15.2.1 values byte for byte.
        gold: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
          950: '#451a03',
        },
        deep: {
          900: '#0f172a',
          950: '#020617',
        },
        // Backgrounds, darkest first (the values the classic layout already paints).
        surface: {
          base: '#000000', // the app root (bg-black)
          deep: '#020617', // body, theme-color, the offline page (= deep-950)
          panel: '#0f172a', // cards, panels, sheets (slate-900)
          raised: '#1e293b', // buttons, inputs, rows (slate-800)
          control: '#334155', // switch tracks, slider rails (slate-700)
        },
        // Text.
        ink: {
          DEFAULT: '#e2e8f0', // body text (index.css; slate-200)
          strong: '#ffffff', // headings, values
          soft: '#cbd5e1', // secondary copy (slate-300)
          muted: '#94a3b8', // labels (slate-400)
          faint: '#64748b', // captions, hints (slate-500)
          accent: '#fbbf24', // gold-400
        },
        // Borders and dividers.
        line: {
          DEFAULT: '#1e293b', // slate-800
          strong: '#334155', // slate-700
          accent: '#f59e0b', // gold-500, used at /20-/60 for gold outlines
        },
        // The frequency regimes in the chakra palette, as the sidebar's alignment buttons colour them (App.tsx:
        // GUT Alignment hover:text-gold-400, HEART Alignment hover:text-green-400, HEAD Alignment
        // hover:text-blue-400).
        regime: {
          gut: '#fbbf24', // gold-400
          perfect: '#34d399', // emerald-400: Perfect GUT, as the Lo Shu controls show it
          heart: '#4ade80', // green-400
          head: '#60a5fa', // blue-400
          source: '#4ade80', // green-400: the 2178 Hz SOURCE centre, as the sidebar's 2178Hz Filter button labels it
        },
        // Status, as Safety Protocols colours its levels (components/SafetyProtocols.tsx getSafetyLevelColor).
        status: {
          ok: '#22c55e', // SAFE (green-500)
          warn: '#eab308', // CAUTION (yellow-500)
          alert: '#f97316', // EXPERT (orange-500)
          error: '#ef4444', // RESEARCH (red-500)
          info: '#60a5fa', // blue-400
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        serif: ['Merriweather', 'serif'],
      },
      // The small sizes the classic layout writes as text-[8px] ... text-[11px]. Font size only, no line height:
      // exactly what those arbitrary classes set, so a later swap is pixel-neutral.
      fontSize: {
        micro: '8px',
        tiny: '9px',
        caption: '10px',
        label: '11px',
      },
      spacing: {
        touch: '2.75rem', // 44px: the minimum tap target (= min-h-11 / min-h-[44px] today)
        row: '4rem', // 64px: a library row
        tabbar: '3.5rem', // 56px: the bottom tab bar
        mini: '4rem', // 64px: the mini player
        transport: '5.5rem', // 88px: the full transport
      },
      borderRadius: {
        control: '0.5rem', // = rounded-lg: buttons, inputs, chips
        card: '0.75rem', // = rounded-xl: cards, popovers
        sheet: '1rem', // = rounded-2xl: sheets, dialogs
        pill: '9999px', // = rounded-full
      },
      boxShadow: {
        raised: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)', // = shadow-lg
        overlay: '0 25px 50px -12px rgb(0 0 0 / 0.25)', // = shadow-2xl
        'glow-gold': '0 0 15px rgba(245, 158, 11, 0.5)', // the header logo's glow
      },
      // The stacking order the classic layout already uses, by role.
      zIndex: {
        header: '30',
        scrim: '40', // click-away catchers
        popover: '50', // popovers, the player bar, the restore toast
        drawer: '60', // the library sidebar
        toast: '70', // status toasts
        notice: '100', // the top notices
        modal: '120', // the record dialog
        sheet: '140', // the output question
        dialog: '150', // the disclaimer, the Frequency Lab
        tutorial: '200',
        top: '9999', // the experience tracker
      },
      transitionDuration: {
        fast: '150ms', // Tailwind's default transition
        base: '300ms',
        slow: '500ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.4, 0, 0.2, 1)', // Tailwind's default
        emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
      },
      animation: {
        'spin-slow': 'spin 20s linear infinite',
        'pulse-slow': 'pulse 8s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
    },
  },
  plugins: [],
};
