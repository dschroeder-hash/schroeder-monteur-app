/**
 * Schröder Corporate Design tokens.
 *
 * Brand colours from the CD manual:
 *   Grün HKS 57  #07915E  (primary / accent – no large green surfaces)
 *   Grau HKS 92  #676C6E
 *   Schwarz HKS 88 #1D1D1B (approximation, see OFFENE-PUNKTE OP-05)
 *
 * White text on #07915E only reaches ~4.0:1 (passes WCAG AA for large text only).
 * Buttons with normal-size text therefore use green-700 (#067A4F, ~5.4:1).
 * All semantic pairs are verified by tokens.test.ts.
 */
export const brand = {
  green: '#07915E',
  gray: '#676C6E',
  black: '#1D1D1B',
  white: '#FFFFFF',
} as const;

export const palette = {
  green50: '#E8F6F0',
  green100: '#C7EADB',
  green300: '#5CC39A',
  green400: '#34C48C',
  green500: brand.green,
  green700: '#067A4F',
  green800: '#05603F',
  gray50: '#F5F6F6',
  gray100: '#E8EAEA',
  gray200: '#D3D6D7',
  gray400: '#9A9FA1',
  gray500: brand.gray,
  gray700: '#45494A',
  gray800: '#2C2F30',
  gray900: '#1D1D1B',
  gray950: '#121413',
  amber100: '#FEF3C7',
  amber300: '#FCD34D',
  amber700: '#A15C07',
  red100: '#FDE2E2',
  red300: '#FCA5A5',
  red700: '#B42318',
  blue100: '#DBEAFE',
  blue300: '#93C5FD',
  blue700: '#1D4ED8',
} as const;

/** Semantic tokens. Keys become CSS custom properties `--color-<key>`. */
export interface SemanticColors {
  bg: string;
  surface: string;
  'surface-muted': string;
  border: string;
  text: string;
  'text-muted': string;
  primary: string;
  'primary-hover': string;
  'on-primary': string;
  accent: string;
  'focus-ring': string;
  success: string;
  'success-bg': string;
  warning: string;
  'warning-bg': string;
  danger: string;
  'danger-bg': string;
  info: string;
  'info-bg': string;
  offline: string;
  /** Side navigation: dark anthracite bar with green active item (strong contrast, no large green areas). */
  'nav-bg': string;
  'nav-text': string;
  'nav-text-muted': string;
  'nav-active-bg': string;
  'nav-active-text': string;
}

export const light: SemanticColors = {
  bg: palette.gray50,
  surface: brand.white,
  'surface-muted': palette.gray100,
  border: palette.gray200,
  text: brand.black,
  'text-muted': brand.gray,
  primary: palette.green700,
  'primary-hover': palette.green800,
  'on-primary': brand.white,
  accent: brand.green,
  'focus-ring': palette.blue700,
  success: palette.green800,
  'success-bg': palette.green50,
  warning: palette.amber700,
  'warning-bg': palette.amber100,
  danger: palette.red700,
  'danger-bg': palette.red100,
  info: palette.blue700,
  'info-bg': palette.blue100,
  offline: palette.gray700,
  'nav-bg': palette.gray900,
  'nav-text': '#F2F4F3',
  'nav-text-muted': palette.gray400,
  'nav-active-bg': palette.green700,
  'nav-active-text': brand.white,
};

export const dark: SemanticColors = {
  bg: palette.gray950,
  surface: palette.gray900,
  'surface-muted': palette.gray800,
  border: palette.gray700,
  text: '#F2F4F3',
  'text-muted': palette.gray400,
  primary: palette.green400,
  'primary-hover': palette.green300,
  'on-primary': palette.gray950,
  accent: palette.green400,
  'focus-ring': palette.blue300,
  success: palette.green300,
  'success-bg': '#0F2A1F',
  warning: palette.amber300,
  'warning-bg': '#2E2208',
  danger: palette.red300,
  'danger-bg': '#3A1414',
  info: palette.blue300,
  'info-bg': '#14213D',
  offline: palette.gray400,
  'nav-bg': '#0A0B0B',
  'nav-text': '#F2F4F3',
  'nav-text-muted': palette.gray400,
  'nav-active-bg': palette.green400,
  'nav-active-text': palette.gray950,
};

/** Pairs that must meet WCAG AA (4.5:1 for normal text). [foreground, background] */
export const CONTRAST_PAIRS: ReadonlyArray<[keyof SemanticColors, keyof SemanticColors]> = [
  ['text', 'bg'],
  ['text', 'surface'],
  ['text', 'surface-muted'],
  ['text-muted', 'surface'],
  ['text-muted', 'bg'],
  ['on-primary', 'primary'],
  ['on-primary', 'primary-hover'],
  ['primary', 'surface'],
  ['success', 'success-bg'],
  ['warning', 'warning-bg'],
  ['danger', 'danger-bg'],
  ['info', 'info-bg'],
  ['danger', 'surface'],
  ['warning', 'surface'],
  ['offline', 'surface'],
  ['nav-text', 'nav-bg'],
  ['nav-text-muted', 'nav-bg'],
  ['nav-active-text', 'nav-active-bg'],
];

export const typography = {
  /** Headlines – Delta BQ Jaeger Medium Italic (licence pending, OP-04), fallback Inter. */
  headline: "'Delta Jaeger', 'Inter', system-ui, sans-serif",
  /** Emphasis – Helvetica Neue Heavy Italic (licence pending), fallback Inter. */
  emphasis: "'Helvetica Neue Heavy', 'Inter', system-ui, sans-serif",
  /** Body text – always upright and highly legible. */
  body: "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
} as const;

export const sizing = {
  /** Minimum touch target (gloves). */
  touchMin: '48px',
  /** Primary stamp buttons in the sticky bottom bar. */
  touchLarge: '64px',
  radius: '10px',
} as const;
