/**
 * ============================================================================
 *  A card's WATERMARK — a large, faint icon behind its rows (CANVAS-BRIEF.md B2)
 * ============================================================================
 *
 *  What a card IS, at a glance: a video file, an audio file, a deliverable. It is
 *  identity — like the table's colour — so it is set on the TABLE, never per canvas
 *  (sql/024, `tables.card_icon`):
 *
 *    { icon? }                    one icon for every card of the table
 *    { byField, map, icon? }      chosen per record from a field's value — the Files
 *                                 table's Media select: video → video, audio → audio…
 *                                 `icon`, if set, is for a value the map does not name
 *
 *  `byField` is a select, a text field, or a single link (its record's label is the
 *  value). Ids that no longer resolve show no watermark rather than fail, like every
 *  other config here. Painting it changes no card arithmetic.
 */
import { z } from 'zod';

export const CARD_ICONS = ['video', 'audio', 'sequence', 'captions', 'document', 'package', 'timeline', 'deliverable', 'generic'] as const;
export type CardIconId = (typeof CARD_ICONS)[number];
export const CARD_ICON_LABELS: Record<CardIconId, string> = {
  video: 'Video', audio: 'Audio', sequence: 'Image sequence', captions: 'Captions', document: 'Document',
  package: 'Package', timeline: 'Timeline', deliverable: 'Deliverable', generic: 'Generic',
};

export const CardIcon = z.strictObject({
  icon: z.enum(CARD_ICONS).optional(),
  byField: z.string().uuid().optional(),
  map: z.record(z.string().max(200), z.enum(CARD_ICONS)).optional(),
}).refine((c) => !c.map || c.byField, { message: 'a value map needs the field it reads (byField)' });
export type CardIcon = z.infer<typeof CardIcon>;

/** The fields a watermark can be chosen by. */
export const canDriveIcon = (f: { type: string; options?: Record<string, unknown> | null }) =>
  f.type === 'select' || f.type === 'text' || (f.type === 'link' && f.options?.single === true);

/**
 * The icon one card wears. `value` is the record's value of `byField` as text — a
 * select's choice, a text, a linked record's label — or undefined/'' when it has none.
 * Values match exactly, then ignoring case and surrounding space ("Video " is video).
 */
export function iconFor(config: unknown, value?: string | null): CardIconId | null {
  const parsed = CardIcon.safeParse(config ?? {});
  if (!parsed.success) return null;
  const c = parsed.data;
  if (c.byField && value) {
    if (c.map?.[value]) return c.map[value];
    const v = value.trim().toLowerCase();
    for (const [k, icon] of Object.entries(c.map ?? {})) if (k.trim().toLowerCase() === v) return icon;
  }
  return c.icon ?? null;
}

/**
 * A first guess for a field's values — what the picker fills in when a field is
 * chosen, so Media's video/audio/image/document come out right with no clicking.
 * Only words it recognises; anything else is left for the person.
 */
const GUESS: Array<[RegExp, CardIconId]> = [
  [/^(video|movie|picture|mov|mxf|prores)$/i, 'video'],
  [/^(audio|sound|wav|stems?|mix)$/i, 'audio'],
  [/^(image|images|sequence|image sequence|frames|dpx|exr|tiff?)$/i, 'sequence'],
  [/^(captions?|subtitles?|cc|srt|scc|timed text)$/i, 'captions'],
  [/^(document|doc|pdf|text|paperwork)$/i, 'document'],
  [/^(package|bundle|imf|dcp|folder)$/i, 'package'],
  [/^(timeline|edit|sequence edit)$/i, 'timeline'],
];
export function suggestMap(values: string[]): Record<string, CardIconId> {
  const out: Record<string, CardIconId> = {};
  for (const v of values) { const hit = GUESS.find(([re]) => re.test(v.trim())); if (hit) out[v] = hit[1]; }
  return out;
}
