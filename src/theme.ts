// Design tokens. Every screen reads colours, spacing and type from here,
// so restyling the whole app means editing this one file.
export const colors = {
  bg: '#0B0B12',
  surface: '#16161F',
  surfaceRaised: '#1F1F2B',
  border: '#2A2A3A',
  text: '#F2F2F7',
  textMuted: '#9A9AB0',
  accent: '#8B7CFF',
  accentText: '#0B0B12',
  danger: '#FF6B6B',
  success: '#4ADE80',
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;
export const radius = { sm: 8, md: 14, lg: 22 } as const;
export const type = {
  title: { fontSize: 28, fontWeight: '700' as const, color: colors.text },
  body: { fontSize: 16, lineHeight: 23, color: colors.text },
  label: { fontSize: 13, fontWeight: '600' as const, color: colors.textMuted, letterSpacing: 0.4 },
};
