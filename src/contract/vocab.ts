/**
 * ============================================================================
 *  Vocabularies — curated choice lists that live in the code, not in a table.
 * ============================================================================
 *
 *  The problem: ffprobe says `prores` / `4444 XQ`, a client's spec says
 *  "Apple ProRes 4444 XQ", a colleague types "PR4444XQ", and a comparison between
 *  any two of those is meaningless. Normalising at COMPARE time (fuzzy matching)
 *  is what makes QC systems untrustworthy. So normalisation happens ONCE, at
 *  extraction, through a table anyone can read — this file — and everything
 *  downstream (specs, compare rules, filters, reports) sees one spelling.
 *
 *  A select field opts in with `options.vocabulary = "video_codec"` (values.ts
 *  `choicesOf`): its choices are then READ FROM HERE each time rather than stored
 *  on the field, so every bound select — on Files, on Deliverables — grows when
 *  this list grows, and nobody can add a near-duplicate through the UI. That is
 *  deliberate friction: the list is versioned with the code and grows by review.
 *  Not a table, not a link field: a Files table built once should not bring a
 *  utility table along with it (the owner's call, Sept 28).
 *
 *  Lookup rule (`lookupCodec`): an entry constrains only the raw fields it lists;
 *  unlisted fields are wildcards; a listed field may give several spellings. The
 *  MOST SPECIFIC matching entry wins, so `{ codec: 'h264' }` gathers every H.264
 *  profile while `{ codec: 'prores', profile: '4444 XQ' }` keeps ProRes profiles
 *  apart — because for ProRes the profile IS the deliverable, and for H.264 the
 *  rare spec that cares can rule on the raw "Codec profile" output instead.
 *  `ambiguities()` finds two entries that could match one input without either
 *  being strictly more specific; test/tools.ts keeps it empty.
 */

export interface CodecEntry {
  id: string;
  /** The one spelling everyone sees. */
  name: string;
  /** What ffprobe reports: `codec_name`, and `profile` when it matters. */
  ffprobe: { codec: string | string[]; profile?: string | string[] };
}

export const VIDEO_CODECS: readonly CodecEntry[] = [
  // Apple ProRes — the profile is the deliverable
  { id: 'prores_4444_xq', name: 'ProRes 4444 XQ', ffprobe: { codec: 'prores', profile: '4444 XQ' } },
  { id: 'prores_4444',    name: 'ProRes 4444',    ffprobe: { codec: 'prores', profile: '4444' } },
  { id: 'prores_422_hq',  name: 'ProRes 422 HQ',  ffprobe: { codec: 'prores', profile: 'HQ' } },
  { id: 'prores_422',     name: 'ProRes 422',     ffprobe: { codec: 'prores', profile: 'Standard' } },
  { id: 'prores_422_lt',  name: 'ProRes 422 LT',  ffprobe: { codec: 'prores', profile: 'LT' } },
  { id: 'prores_proxy',   name: 'ProRes 422 Proxy', ffprobe: { codec: 'prores', profile: 'Proxy' } },
  { id: 'prores_raw',     name: 'ProRes RAW',     ffprobe: { codec: 'prores_raw' } },
  // Avid DNx — ffprobe reports both HD and HR as `dnxhd`; the profile tells them apart
  { id: 'dnxhr_444', name: 'DNxHR 444', ffprobe: { codec: 'dnxhd', profile: 'DNxHR 444' } },
  { id: 'dnxhr_hqx', name: 'DNxHR HQX', ffprobe: { codec: 'dnxhd', profile: 'DNxHR HQX' } },
  { id: 'dnxhr_hq',  name: 'DNxHR HQ',  ffprobe: { codec: 'dnxhd', profile: 'DNxHR HQ' } },
  { id: 'dnxhr_sq',  name: 'DNxHR SQ',  ffprobe: { codec: 'dnxhd', profile: 'DNxHR SQ' } },
  { id: 'dnxhr_lb',  name: 'DNxHR LB',  ffprobe: { codec: 'dnxhd', profile: 'DNxHR LB' } },
  { id: 'dnxhd',     name: 'DNxHD',     ffprobe: { codec: 'dnxhd' } },   // any other profile: the fixed-bitrate HD family
  // Long-GOP and web
  { id: 'h264',  name: 'H.264',  ffprobe: { codec: 'h264' } },          // every profile
  { id: 'hevc',  name: 'HEVC',   ffprobe: { codec: ['hevc', 'h265'] } },
  { id: 'av1',   name: 'AV1',    ffprobe: { codec: 'av1' } },
  { id: 'vp9',   name: 'VP9',    ffprobe: { codec: 'vp9' } },
  { id: 'mpeg2', name: 'MPEG-2', ffprobe: { codec: 'mpeg2video' } },
  { id: 'mpeg4', name: 'MPEG-4 Part 2', ffprobe: { codec: 'mpeg4' } },
  // Intra-frame broadcast and cinema
  { id: 'xdcam',    name: 'XDCAM HD422', ffprobe: { codec: 'mpeg2video', profile: '4:2:2' } },
  { id: 'jpeg2000', name: 'JPEG 2000',   ffprobe: { codec: 'jpeg2000' } },
  { id: 'cineform', name: 'CineForm',    ffprobe: { codec: 'cfhd' } },
  { id: 'ffv1',     name: 'FFV1',        ffprobe: { codec: 'ffv1' } },
  { id: 'uncompressed', name: 'Uncompressed', ffprobe: { codec: ['rawvideo', 'v210', 'v410', 'r210', 'r10k', 'v308', 'yuv4'] } },
  // Image sequences (ffprobe reports the frame codec)
  { id: 'exr',  name: 'OpenEXR', ffprobe: { codec: 'exr' } },
  { id: 'dpx',  name: 'DPX',     ffprobe: { codec: 'dpx' } },
  { id: 'tiff', name: 'TIFF',    ffprobe: { codec: 'tiff' } },
  { id: 'png',  name: 'PNG',     ffprobe: { codec: 'png' } },
  { id: 'jpeg', name: 'JPEG',    ffprobe: { codec: 'mjpeg' } },
  // Camera raw and mezzanine formats ffprobe can at least name
  { id: 'braw',  name: 'Blackmagic RAW', ffprobe: { codec: 'braw' } },
  { id: 'redcode', name: 'REDCODE RAW',  ffprobe: { codec: 'redcode' } },
  { id: 'arriraw', name: 'ARRIRAW',      ffprobe: { codec: 'arriraw' } },
];

/** Every vocabulary a select may bind to. A vocabulary is a name and a choice list. */
export const VOCABULARIES: Record<string, { name: string; choices: readonly string[] }> = {
  video_codec: { name: 'Video codec', choices: VIDEO_CODECS.map((c) => c.name) },
};
export const VOCABULARY_IDS = Object.keys(VOCABULARIES);

/** Why `options.vocabulary` is not acceptable on a select field, or null. */
export function vocabularyOptionError(options: Record<string, unknown> | null | undefined): string | null {
  const v = options?.vocabulary;
  if (v === undefined) return null;
  if (typeof v !== 'string' || !(v in VOCABULARIES)) return `unknown vocabulary '${String(v)}' — one of: ${VOCABULARY_IDS.join(', ')}`;
  if (Array.isArray(options?.choices) && (options!.choices as unknown[]).length) return 'a select bound to a vocabulary has no choices of its own';
  return null;
}

/* ── the lookup ──────────────────────────────────────────────────────────── */

const list = (v: string | string[] | undefined) => (v === undefined ? undefined : Array.isArray(v) ? v : [v]);
const specificity = (e: CodecEntry) => (e.ffprobe.profile !== undefined ? 1 : 0);

function matches(e: CodecEntry, codec: string, profile: string | undefined): boolean {
  const c = list(e.ffprobe.codec)!;
  if (!c.some((x) => x.toLowerCase() === codec.toLowerCase())) return false;
  const p = list(e.ffprobe.profile);
  if (p === undefined) return true;
  return profile !== undefined && p.some((x) => x.toLowerCase() === profile.toLowerCase());
}

/**
 * The canonical codec for what ffprobe reported, or undefined when the table has
 * no entry — the caller then writes nothing to `codec` (the raw pair is still there
 * if mapped) and says so, which is how the table learns what it is missing.
 */
export function lookupCodec(codec: string | undefined, profile: string | undefined): CodecEntry | undefined {
  if (!codec) return undefined;
  const hits = VIDEO_CODECS.filter((e) => matches(e, codec, profile));
  if (!hits.length) return undefined;
  return hits.sort((a, b) => specificity(b) - specificity(a))[0];
}

/**
 * Pairs of entries that could match the SAME input with neither strictly more
 * specific than the other — an ambiguous table. Must be empty (test/tools.ts).
 */
export function ambiguities(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (let i = 0; i < VIDEO_CODECS.length; i++) {
    for (let j = i + 1; j < VIDEO_CODECS.length; j++) {
      const a = VIDEO_CODECS[i], b = VIDEO_CODECS[j];
      const codecs = list(a.ffprobe.codec)!.filter((c) => list(b.ffprobe.codec)!.some((d) => d.toLowerCase() === c.toLowerCase()));
      if (!codecs.length) continue;
      if (specificity(a) !== specificity(b)) continue;   // one is strictly more specific: fine
      const pa = list(a.ffprobe.profile), pb = list(b.ffprobe.profile);
      const overlap = pa === undefined || pb === undefined || pa.some((p) => pb.some((q) => q.toLowerCase() === p.toLowerCase()));
      if (overlap) out.push([a.id, b.id]);
    }
  }
  return out;
}
