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
 *
 *  Since Oct 17 the same output may also land in a LINK field, to a table the
 *  owner maintains ("Containers": one row per container, a Name and an optional
 *  Aliases column). The code's lookup still does the normalising — raw → canonical
 *  name — and the drop then finds the ROW with that name (`resolveRow`); what the
 *  code does not know, a row's aliases can teach it. The owner's reasons (Oct 17):
 *  a vocabulary has to be SHARED between the spec side (Deliverables) and the file
 *  side (Files) — two selects each own their choices, one table that both link to
 *  cannot disagree — and a real project wanted "MXF OP1a" vs "MXF OP-Atom", which
 *  no built-in list had. (That supersedes the Sept 28 call that a Files table
 *  should not bring a utility table along; the table is the point now.)
 *  VOCABULARIES.md lists every entry below with the raw spellings it accepts; it is
 *  generated from this file (`npm run vocab:doc`) and test/tools.ts keeps it current.
 *
 *  Five lists (Oct 15): the video codec, the audio codec, the container, and the
 *  three colour signals — primaries, transfer, matrix. Each is the same machine:
 *
 *  Lookup rule (`lookup`): an entry names RAW keys (what ffprobe reported) with the
 *  spellings it accepts for each; a key it does not list is a wildcard; a listed
 *  key may give several spellings, a trailing `*` matches a prefix ("pcm_*"), and
 *  "" matches the key being ABSENT. The MOST SPECIFIC matching entry (the most
 *  listed keys) wins, so `{ codec: 'h264' }` gathers every H.264 profile while
 *  `{ codec: 'prores', profile: '4444 XQ' }` keeps ProRes profiles apart — because
 *  for ProRes the profile IS the deliverable, and for H.264 the rare spec that
 *  cares can rule on the raw "Codec profile" output instead. No match → undefined,
 *  never a guess: the raw value stays in its own column and the drop reports what
 *  the table is missing. `ambiguities()` finds two entries of one list that could
 *  match one input without either being strictly more specific; test/tools.ts
 *  keeps it empty.
 */

export interface VocabEntry {
  id: string;
  /** The one spelling everyone sees. */
  name: string;
  /** Raw key → the spellings accepted for it (case-insensitive; `*` suffix = prefix; "" = absent). */
  raw: Record<string, string | readonly string[]>;
}
export interface Vocabulary {
  name: string;
  /** The raw keys the lookup reads, named as the ffprobe analyzer's outputs name them (contract/tools.ts). */
  keys: readonly string[];
  entries: readonly VocabEntry[];
}

/* ── video codecs ────────────────────────────────────────────────────────── */

/** `codec` is ffprobe's `codec_name`; `profile` its `profile`, when it matters. */
export const VIDEO_CODECS: readonly VocabEntry[] = [
  // Apple ProRes — the profile is the deliverable
  { id: 'prores_4444_xq', name: 'ProRes 4444 XQ', raw: { codec: 'prores', profile: '4444 XQ' } },
  { id: 'prores_4444',    name: 'ProRes 4444',    raw: { codec: 'prores', profile: '4444' } },
  { id: 'prores_422_hq',  name: 'ProRes 422 HQ',  raw: { codec: 'prores', profile: 'HQ' } },
  { id: 'prores_422',     name: 'ProRes 422',     raw: { codec: 'prores', profile: 'Standard' } },
  { id: 'prores_422_lt',  name: 'ProRes 422 LT',  raw: { codec: 'prores', profile: 'LT' } },
  { id: 'prores_proxy',   name: 'ProRes 422 Proxy', raw: { codec: 'prores', profile: 'Proxy' } },
  { id: 'prores_raw',     name: 'ProRes RAW',     raw: { codec: 'prores_raw' } },
  // Avid DNx — ffprobe reports both HD and HR as `dnxhd`; the profile tells them apart
  { id: 'dnxhr_444', name: 'DNxHR 444', raw: { codec: 'dnxhd', profile: 'DNxHR 444' } },
  { id: 'dnxhr_hqx', name: 'DNxHR HQX', raw: { codec: 'dnxhd', profile: 'DNxHR HQX' } },
  { id: 'dnxhr_hq',  name: 'DNxHR HQ',  raw: { codec: 'dnxhd', profile: 'DNxHR HQ' } },
  { id: 'dnxhr_sq',  name: 'DNxHR SQ',  raw: { codec: 'dnxhd', profile: 'DNxHR SQ' } },
  { id: 'dnxhr_lb',  name: 'DNxHR LB',  raw: { codec: 'dnxhd', profile: 'DNxHR LB' } },
  { id: 'dnxhd',     name: 'DNxHD',     raw: { codec: 'dnxhd' } },   // any other profile: the fixed-bitrate HD family
  // Long-GOP and web
  { id: 'h264',  name: 'H.264',  raw: { codec: 'h264' } },          // every profile
  { id: 'hevc',  name: 'HEVC',   raw: { codec: ['hevc', 'h265'] } },
  { id: 'av1',   name: 'AV1',    raw: { codec: 'av1' } },
  { id: 'vp9',   name: 'VP9',    raw: { codec: 'vp9' } },
  { id: 'mpeg2', name: 'MPEG-2', raw: { codec: 'mpeg2video' } },
  { id: 'mpeg4', name: 'MPEG-4 Part 2', raw: { codec: 'mpeg4' } },
  // Intra-frame broadcast and cinema
  { id: 'xdcam',    name: 'XDCAM HD422', raw: { codec: 'mpeg2video', profile: '4:2:2' } },
  { id: 'jpeg2000', name: 'JPEG 2000',   raw: { codec: 'jpeg2000' } },
  { id: 'cineform', name: 'CineForm',    raw: { codec: 'cfhd' } },
  { id: 'ffv1',     name: 'FFV1',        raw: { codec: 'ffv1' } },
  { id: 'uncompressed', name: 'Uncompressed', raw: { codec: ['rawvideo', 'v210', 'v410', 'r210', 'r10k', 'v308', 'yuv4'] } },
  // Image sequences (ffprobe reports the frame codec)
  { id: 'exr',  name: 'OpenEXR', raw: { codec: 'exr' } },
  { id: 'dpx',  name: 'DPX',     raw: { codec: 'dpx' } },
  { id: 'tiff', name: 'TIFF',    raw: { codec: 'tiff' } },
  { id: 'png',  name: 'PNG',     raw: { codec: 'png' } },
  { id: 'jpeg', name: 'JPEG',    raw: { codec: 'mjpeg' } },
  // Camera raw and mezzanine formats ffprobe can at least name
  { id: 'braw',  name: 'Blackmagic RAW', raw: { codec: 'braw' } },
  { id: 'redcode', name: 'REDCODE RAW',  raw: { codec: 'redcode' } },
  { id: 'arriraw', name: 'ARRIRAW',      raw: { codec: 'arriraw' } },
];

/* ── audio codecs ────────────────────────────────────────────────────────── */

/**
 * `codec` is the first audio stream's `codec_name`. Every `pcm_*` is PCM: the
 * sample format (s24le, s16be, f32le) is endianness and depth, and the depth is its
 * own output ("Audio bit depth"). Dolby's names are what a spec says, with the
 * standard's name beside it, because both get written.
 */
export const AUDIO_CODECS: readonly VocabEntry[] = [
  { id: 'pcm',     name: 'PCM',                        raw: { codec: 'pcm_*' } },
  { id: 'aac',     name: 'AAC',                        raw: { codec: 'aac' } },
  { id: 'ac3',     name: 'Dolby Digital (AC-3)',       raw: { codec: 'ac3' } },
  { id: 'eac3',    name: 'Dolby Digital Plus (E-AC-3)', raw: { codec: 'eac3' } },
  { id: 'truehd',  name: 'Dolby TrueHD',               raw: { codec: 'truehd' } },
  { id: 'dolby_e', name: 'Dolby E',                    raw: { codec: 'dolby_e' } },
  { id: 'dts',     name: 'DTS',                        raw: { codec: 'dts' } },             // every DTS flavour; the raw profile says which
  { id: 'flac',    name: 'FLAC',                       raw: { codec: 'flac' } },
  { id: 'alac',    name: 'ALAC',                       raw: { codec: 'alac' } },
  { id: 'mp3',     name: 'MP3',                        raw: { codec: 'mp3' } },
  { id: 'mp2',     name: 'MP2',                        raw: { codec: 'mp2' } },
  { id: 'opus',    name: 'Opus',                       raw: { codec: 'opus' } },
  { id: 'vorbis',  name: 'Vorbis',                     raw: { codec: 'vorbis' } },
  { id: 'wma',     name: 'WMA',                        raw: { codec: ['wmav1', 'wmav2', 'wmapro', 'wmalossless'] } },
];

/* ── containers ──────────────────────────────────────────────────────────── */

/**
 * `format` is ffprobe's `format_name`, whole. It cannot tell a .mov from an .mp4:
 * both are "mov,mp4,m4a,3gp,3g2,mj2". The `ftyp` atom can — `brand` is the file's
 * `major_brand` tag ("qt  " is QuickTime; the ISO brands are MP4) — and a MOV old
 * enough to have no `ftyp` at all (brand absent, "") is QuickTime too. An unknown
 * brand in that family matches nothing: say so, do not guess. Matroska and WebM
 * share a `format_name` and are told apart by `extension`.
 *
 * MXF's operational pattern — OP1a (one file, all essence; what broadcasters take)
 * vs OP-Atom (one essence track per file; Avid's) — is `op`, decoded by the probe
 * (probe.rs `mxf_op`) from the `operational_pattern_ul` tag ffprobe reports: byte
 * 13 of the UL is the pattern (0x01 OP1 … 0x03 OP3, 0x10 OP-Atom) and byte 14 the
 * letter (0x01 a, 0x02 b, 0x03 c). Plain "MXF" is the fallback for a pattern the
 * entries do not name, or a file whose UL ffprobe did not report.
 */
export const CONTAINERS: readonly VocabEntry[] = [
  { id: 'quicktime', name: 'QuickTime', raw: { format: 'mov,mp4,m4a,3gp,3g2,mj2', brand: ['qt', ''] } },
  { id: 'mp4',       name: 'MP4',       raw: { format: 'mov,mp4,m4a,3gp,3g2,mj2', brand: ['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'mp71', 'avc1', 'm4v', 'm4a', 'dash', 'msnv', 'f4v', 'mp4v', 'hvc1', 'av01'] } },
  { id: 'mxf_op1a',  name: 'MXF OP1a',  raw: { format: 'mxf', op: 'OP1a' } },
  { id: 'mxf_op1b',  name: 'MXF OP1b',  raw: { format: 'mxf', op: 'OP1b' } },
  { id: 'mxf_opatom', name: 'MXF OP-Atom', raw: { format: 'mxf', op: 'OP-Atom' } },
  { id: 'mxf',       name: 'MXF',       raw: { format: 'mxf' } },                       // any other pattern, or none reported
  { id: 'wav',       name: 'WAV',       raw: { format: 'wav' } },                       // RF64 reports as wav too
  { id: 'w64',       name: 'Wave64',    raw: { format: 'w64' } },
  { id: 'aiff',      name: 'AIFF',      raw: { format: 'aiff' } },
  { id: 'flac',      name: 'FLAC',      raw: { format: 'flac' } },
  { id: 'mp3',       name: 'MP3',       raw: { format: 'mp3' } },
  { id: 'ac3',       name: 'AC-3 elementary',  raw: { format: 'ac3' } },
  { id: 'eac3',      name: 'E-AC-3 elementary', raw: { format: 'eac3' } },
  { id: 'matroska',  name: 'Matroska',  raw: { format: 'matroska,webm', extension: ['mkv', 'mka', 'mks', 'mk3d'] } },
  { id: 'webm',      name: 'WebM',      raw: { format: 'matroska,webm', extension: 'webm' } },
  { id: 'avi',       name: 'AVI',       raw: { format: 'avi' } },
  { id: 'mpegts',    name: 'MPEG-TS',   raw: { format: 'mpegts' } },
  { id: 'mpegps',    name: 'MPEG-PS',   raw: { format: 'mpeg' } },
  { id: 'ogg',       name: 'Ogg',       raw: { format: 'ogg' } },
  { id: 'images',    name: 'Image file(s)', raw: { format: ['image2', 'image2pipe', 'exr_pipe', 'dpx_pipe', 'tiff_pipe', 'png_pipe', 'jpeg_pipe', 'bmp_pipe', 'webp_pipe', 'j2k_pipe', 'gif'] } },   // a sequence's frames, or one still
];

/* ── colour: primaries, transfer, matrix ────────────────────────────────── */

/** `primaries` is ffprobe's `color_primaries`. Named as a spec writes them. */
export const COLOR_PRIMARIES: readonly VocabEntry[] = [
  { id: 'bt709',    name: 'Rec. 709',       raw: { primaries: 'bt709' } },
  { id: 'bt2020',   name: 'Rec. 2020',      raw: { primaries: 'bt2020' } },
  { id: 'p3d65',    name: 'P3-D65',         raw: { primaries: 'smpte432' } },
  { id: 'p3dci',    name: 'P3-DCI',         raw: { primaries: 'smpte431' } },
  { id: 'bt601_625', name: 'Rec. 601 (625)', raw: { primaries: 'bt470bg' } },
  { id: 'bt601_525', name: 'Rec. 601 (525)', raw: { primaries: 'smpte170m' } },
  { id: 'smpte240m', name: 'SMPTE 240M',    raw: { primaries: 'smpte240m' } },
  { id: 'bt470m',   name: 'NTSC 1953 (BT.470 M)', raw: { primaries: 'bt470m' } },
  { id: 'film',     name: 'Film (Illuminant C)', raw: { primaries: 'film' } },
  { id: 'xyz',      name: 'XYZ (SMPTE 428)', raw: { primaries: 'smpte428' } },
  { id: 'ebu3213',  name: 'EBU 3213',       raw: { primaries: ['jedec-p22', 'ebu3213'] } },
];

/** `transfer` is ffprobe's `color_transfer`. */
export const COLOR_TRANSFERS: readonly VocabEntry[] = [
  { id: 'bt709',    name: 'Rec. 709',        raw: { transfer: 'bt709' } },
  { id: 'pq',       name: 'PQ (SMPTE 2084)', raw: { transfer: 'smpte2084' } },
  { id: 'hlg',      name: 'HLG',             raw: { transfer: 'arib-std-b67' } },
  { id: 'bt2020',   name: 'Rec. 2020',       raw: { transfer: ['bt2020-10', 'bt2020-12'] } },
  { id: 'srgb',     name: 'sRGB',            raw: { transfer: 'iec61966-2-1' } },
  { id: 'linear',   name: 'Linear',          raw: { transfer: 'linear' } },
  { id: 'bt601',    name: 'Rec. 601',        raw: { transfer: 'smpte170m' } },
  { id: 'gamma22',  name: 'Gamma 2.2',       raw: { transfer: ['gamma22', 'bt470m'] } },
  { id: 'gamma28',  name: 'Gamma 2.8',       raw: { transfer: ['gamma28', 'bt470bg'] } },
  { id: 'smpte240m', name: 'SMPTE 240M',     raw: { transfer: 'smpte240m' } },
  { id: 'dcdm',     name: 'SMPTE 428 (DCDM)', raw: { transfer: 'smpte428' } },
  { id: 'log',      name: 'Log',             raw: { transfer: ['log100', 'log316'] } },
  { id: 'bt1361',   name: 'BT.1361',         raw: { transfer: 'bt1361e' } },
  { id: 'xvycc',    name: 'xvYCC',           raw: { transfer: 'iec61966-2-4' } },
];

/** `matrix` is ffprobe's `color_space` (the YCbCr matrix, not a colour space). */
export const COLOR_MATRICES: readonly VocabEntry[] = [
  { id: 'bt709',    name: 'Rec. 709',               raw: { matrix: 'bt709' } },
  { id: 'bt2020nc', name: 'Rec. 2020 (non-constant)', raw: { matrix: 'bt2020nc' } },
  { id: 'bt2020c',  name: 'Rec. 2020 (constant)',  raw: { matrix: 'bt2020c' } },
  { id: 'ictcp',    name: 'ICtCp',                  raw: { matrix: 'ictcp' } },
  { id: 'bt601',    name: 'Rec. 601',               raw: { matrix: ['smpte170m', 'bt470bg'] } },
  { id: 'rgb',      name: 'RGB (identity)',         raw: { matrix: ['rgb', 'gbr'] } },
  { id: 'ycgco',    name: 'YCgCo',                  raw: { matrix: 'ycgco' } },
  { id: 'fcc',      name: 'FCC',                    raw: { matrix: 'fcc' } },
  { id: 'smpte240m', name: 'SMPTE 240M',            raw: { matrix: 'smpte240m' } },
  { id: 'chroma_derived', name: 'Chroma-derived',   raw: { matrix: ['chroma-derived-nc', 'chroma-derived-c'] } },
];

/* ── the registry ─────────────────────────────────────────────────────────── */

/** Every vocabulary a select may bind to. */
export const VOCABULARY_TABLES: Record<string, Vocabulary> = {
  video_codec:      { name: 'Video codec',      keys: ['codec', 'profile'],               entries: VIDEO_CODECS },
  audio_codec:      { name: 'Audio codec',      keys: ['codec'],                          entries: AUDIO_CODECS },
  container:        { name: 'Container',        keys: ['format', 'brand', 'extension', 'op'], entries: CONTAINERS },
  color_primaries:  { name: 'Colour primaries', keys: ['primaries'],                      entries: COLOR_PRIMARIES },
  color_transfer:   { name: 'Transfer function', keys: ['transfer'],                      entries: COLOR_TRANSFERS },
  color_matrix:     { name: 'Colour matrix',    keys: ['matrix'],                         entries: COLOR_MATRICES },
};
/** A vocabulary as a select sees it: a name and a choice list (the canonical names, in table order). */
export const VOCABULARIES: Record<string, { name: string; choices: readonly string[] }> =
  Object.fromEntries(Object.entries(VOCABULARY_TABLES).map(([id, v]) => [id, { name: v.name, choices: v.entries.map((e) => e.name) }]));
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

const list = (v: string | readonly string[]): readonly string[] => (typeof v === 'string' ? [v] : v);
const specificity = (e: VocabEntry) => Object.keys(e.raw).length;

/** One accepted spelling against one raw value: exact, prefix (`*`), or absent (""). */
function spells(spelling: string, raw: string | undefined): boolean {
  const s = spelling.toLowerCase();
  if (raw === undefined) return s === '';
  const r = raw.trim().toLowerCase();
  return s.endsWith('*') ? r.startsWith(s.slice(0, -1)) : r === s;
}
function matches(e: VocabEntry, raw: Record<string, string | undefined>): boolean {
  return Object.entries(e.raw).every(([key, accepted]) => list(accepted).some((s) => spells(s, raw[key])));
}

/**
 * The canonical entry for what ffprobe reported, or undefined when the list has no
 * entry — the caller then writes nothing canonical (the raw value is still there if
 * mapped) and says so, which is how a list learns what it is missing.
 */
export function lookup(vocabulary: string, raw: Record<string, string | undefined>): VocabEntry | undefined {
  const v = VOCABULARY_TABLES[vocabulary];
  if (!v) return undefined;
  const hits = v.entries.filter((e) => matches(e, raw));
  if (!hits.length) return undefined;
  return [...hits].sort((a, b) => specificity(b) - specificity(a))[0];
}

/** The video codec for ffprobe's `codec_name` + `profile`. */
export const lookupCodec = (codec: string | undefined, profile: string | undefined): VocabEntry | undefined =>
  codec ? lookup('video_codec', { codec, profile }) : undefined;

/* ── a vocabulary TABLE: finding the row ──────────────────────────────────── */

/**
 * A row of a vocabulary table as the resolver sees it: its primary text and the
 * contents of its Aliases column (a text or long-text field whose key is
 * `aliases`), when it has one.
 */
export interface VocabRow { id: string; name: string; aliases?: unknown }
export const ALIASES_KEY = 'aliases';

/** One alias per line, or comma- or semicolon-separated; trimmed, empties dropped. */
export function splitAliases(text: unknown): string[] {
  return typeof text === 'string' ? text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean) : [];
}
/** The raw values as ONE spelling a person can paste into Aliases: "prores / 4444 XQ". */
export const rawSpelling = (raw: readonly string[]): string => raw.join(' / ');

const norm = (s: string) => s.trim().toLowerCase();

/**
 * Which row of a vocabulary table a drop should link, given what the code's lookup
 * made of the raw values (`canonical`, or undefined when the list has no entry) and
 * the raw values themselves. In order, case-insensitively:
 *   1. a row NAMED the canonical name — the ordinary case;
 *   2. a row with the canonical name among its aliases — the owner spells it
 *      differently ("QuickTime" is their "MOV");
 *   3. a row with the raw spelling (`rawSpelling`) or any single raw value among its
 *      aliases — what the code does not know, the table teaches it ("op1a").
 * Undefined when nothing matches: the drop writes no link and says so, naming the
 * spelling that would have matched. Never a guess.
 */
export function resolveRow<R extends VocabRow>(rows: readonly R[], canonical: string | undefined, raw: readonly string[] = []): R | undefined {
  const c = canonical === undefined ? undefined : norm(canonical);
  const aliasesOf = (r: R) => splitAliases(r.aliases).map(norm);
  if (c !== undefined) {
    const named = rows.find((r) => norm(r.name) === c);
    if (named) return named;
    const aliased = rows.find((r) => aliasesOf(r).includes(c));
    if (aliased) return aliased;
  }
  const spellings = [rawSpelling(raw), ...raw].map(norm).filter(Boolean);
  if (!spellings.length) return undefined;
  return rows.find((r) => { const a = aliasesOf(r); return spellings.some((s) => a.includes(s)); });
}

/** Could these two spellings accept one and the same raw value? */
function spellingsOverlap(a: string, b: string): boolean {
  const x = a.toLowerCase(), y = b.toLowerCase();
  if (x === '' || y === '') return x === y;
  const px = x.endsWith('*') ? x.slice(0, -1) : null, py = y.endsWith('*') ? y.slice(0, -1) : null;
  if (px !== null && py !== null) return px.startsWith(py) || py.startsWith(px);
  if (px !== null) return y.startsWith(px);
  if (py !== null) return x.startsWith(py);
  return x === y;
}

/**
 * Pairs of entries, in any list, that could match the SAME input with neither
 * strictly more specific than the other — an ambiguous table. Must be empty
 * (test/tools.ts). Each pair is "<vocabulary>:<id>".
 */
export function ambiguities(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const [vid, v] of Object.entries(VOCABULARY_TABLES)) {
    const es = v.entries;
    for (let i = 0; i < es.length; i++) {
      for (let j = i + 1; j < es.length; j++) {
        const a = es[i], b = es[j];
        if (specificity(a) !== specificity(b)) {
          // The more specific one wins only if it is a REFINEMENT: every key the
          // less specific lists, it lists too (with overlapping spellings).
          const [less, more] = specificity(a) < specificity(b) ? [a, b] : [b, a];
          const refined = Object.keys(less.raw).every((k) => k in more.raw);
          if (refined) continue;
        }
        // Both could match one input when every key EITHER lists has overlapping
        // spellings (a key only one lists is a wildcard for the other).
        const keys = new Set([...Object.keys(a.raw), ...Object.keys(b.raw)]);
        const overlap = [...keys].every((k) => {
          if (!(k in a.raw) || !(k in b.raw)) return true;
          return list(a.raw[k]).some((p) => list(b.raw[k]).some((q) => spellingsOverlap(p, q)));
        });
        if (overlap) out.push([`${vid}:${a.id}`, `${vid}:${b.id}`]);
      }
    }
  }
  return out;
}
