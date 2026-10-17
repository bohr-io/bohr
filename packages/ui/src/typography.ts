export interface TypographyPreset {
  fontSize: string;
  fontWeight: string;
  lineHeight: string;
  letterSpacing: string;
  textTransform: string;
}

/** Type scale from v1 (src/assets/typography.ts). */
export const typographyPresets = {
  title1: { fontSize: '48px', fontWeight: '700', lineHeight: '55px', letterSpacing: '-0.004em', textTransform: 'none' },
  title2: { fontSize: '24px', fontWeight: '700', lineHeight: '28px', letterSpacing: '-0.004em', textTransform: 'none' },
  title3: { fontSize: '18px', fontWeight: '700', lineHeight: '21px', letterSpacing: '-0.002em', textTransform: 'none' },
  title4: {
    fontSize: '12px',
    fontWeight: '700',
    lineHeight: '14px',
    letterSpacing: '-0.002em',
    textTransform: 'uppercase',
  },
  subtitle1: {
    fontSize: '24px',
    fontWeight: '700',
    lineHeight: '28px',
    letterSpacing: 'normal',
    textTransform: 'none',
  },
  subtitle2: {
    fontSize: '16px',
    fontWeight: '700',
    lineHeight: '18px',
    letterSpacing: '-0.67px',
    textTransform: 'none',
  },
  body1: { fontSize: '14px', fontWeight: '400', lineHeight: '16px', letterSpacing: 'normal', textTransform: 'none' },
  body2: { fontSize: '12px', fontWeight: '400', lineHeight: '24px', letterSpacing: 'normal', textTransform: 'none' },
  body3: { fontSize: '10px', fontWeight: '400', lineHeight: '11px', letterSpacing: 'normal', textTransform: 'none' },
} as const satisfies Record<string, TypographyPreset>;

export type TypographyVariant = keyof typeof typographyPresets;
