// Design tokens for the whole app. Restyle everything from this one file.
// Look: soft pastel wellness app. Warm cream base, lavender accent,
// a pastel per coach, rounded cards, Fraunces serif headings, Nunito body.

export const palette = {
  cream: '#FBF7F2',
  paper: '#FFFFFF',
  ink: '#2E2A3B',
  inkSoft: '#5E5873',
  muted: '#8E88A3',
  line: '#ECE6F2',
  lavender: '#E9E3FF',
  lavenderDeep: '#7C6CF2',
  peach: '#FFE5D9',
  peachDeep: '#F08A63',
  mint: '#DCF3E8',
  mintDeep: '#3FA77A',
  sky: '#DDEBFF',
  skyDeep: '#4D8BE8',
  butter: '#FFF2C7',
  butterDeep: '#C99A1C',
  rose: '#FFDDE6',
  roseDeep: '#E2587F',
  lilac: '#F1E4FA',
  lilacDeep: '#A25CC9',
  sage: '#E6EEDC',
  sageDeep: '#6D8A4B',
  danger: '#E5536B',
} as const;

export const colors = {
  bg: palette.cream,
  surface: palette.paper,
  surfaceSoft: '#F6F1FB',
  border: palette.line,
  text: palette.ink,
  textSoft: palette.inkSoft,
  textMuted: palette.muted,
  accent: palette.lavenderDeep,
  accentSoft: palette.lavender,
  onAccent: '#FFFFFF',
  danger: palette.danger,
  success: palette.mintDeep,
} as const;

// Background wash used behind every screen.
export const gradients = {
  screen: ['#FBF7F2', '#F7F0FB', '#EEF3FF'] as const,
  hero: ['#E9E3FF', '#FFE5D9'] as const,
  night: ['#E3E6FF', '#F1E4FA'] as const,
};

export const fonts = {
  display: 'Fraunces_600SemiBold',
  displayItalic: 'Fraunces_400Regular_Italic',
  body: 'Nunito_400Regular',
  bodyMedium: 'Nunito_600SemiBold',
  bodyBold: 'Nunito_700Bold',
  bodyHeavy: 'Nunito_800ExtraBold',
} as const;

export const space = { xxs: 2, xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 10, md: 18, lg: 26, pill: 999 } as const;

export const shadow = {
  shadowColor: '#6B5BD6',
  shadowOpacity: 0.08,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 3,
} as const;

export const type = {
  hero: { fontFamily: fonts.display, fontSize: 32, lineHeight: 38, color: colors.text },
  title: { fontFamily: fonts.display, fontSize: 24, lineHeight: 30, color: colors.text },
  heading: { fontFamily: fonts.bodyHeavy, fontSize: 17, lineHeight: 22, color: colors.text },
  body: { fontFamily: fonts.body, fontSize: 16, lineHeight: 23, color: colors.text },
  bodySoft: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.textSoft },
  small: { fontFamily: fonts.bodyMedium, fontSize: 13, lineHeight: 18, color: colors.textMuted },
  label: {
    fontFamily: fonts.bodyHeavy,
    fontSize: 12,
    letterSpacing: 1.1,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
  },
  quote: { fontFamily: fonts.displayItalic, fontSize: 18, lineHeight: 26, color: colors.textSoft },
};
