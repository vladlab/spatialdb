/**
 * Text colour for a user-chosen background: dark on a light one, light on a dark
 * one. Table colours are whatever the owner picked, and a pale peach header with
 * pale-grey text (the theme's default) was unreadable. Relative luminance per
 * WCAG, threshold 0.5. A colour that is not a hex value (a CSS variable, a name we
 * cannot parse) gets no override: the theme's own text colour stays.
 */
export function textOn(background: string | undefined | null): string | undefined {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((background ?? '').trim());
  if (!m) return undefined;
  const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.5 ? '#1a1a1a' : '#f2f2f2';
}
