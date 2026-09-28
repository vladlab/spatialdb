/**
 * Text colour for a user-chosen background: dark on a light one, light on a dark
 * one. Table colours are whatever the owner picked, and a pale peach header with
 * pale-grey text (the theme's default) was unreadable.
 *
 * The rule: whichever of black and white has the HIGHER CONTRAST RATIO against the
 * background (WCAG relative luminance L; black's ratio is (L+.05)/.05, white's
 * 1.05/(L+.05); they cross at L ≈ 0.179). A first cut used a midpoint of 0.5, and a
 * tan at L = 0.49 — plainly light — kept white text. A colour that is not a hex
 * value gets no override: the theme's own text colour stays.
 */
export function textOn(background: string | undefined | null): string | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((background ?? '').trim());
  if (!m) return undefined;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.179 ? '#1a1a1a' : '#f2f2f2';
}
