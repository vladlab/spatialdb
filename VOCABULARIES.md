# Vocabularies — raw ffprobe output → one canonical name

*Generated from `src/contract/vocab.ts` by `npm run vocab:doc`. Do not edit by hand; edit the code and re-run (test/tools.ts fails while this page is behind).*

ffprobe says `prores` / `4444 XQ`; a spec says "Apple ProRes 4444 XQ"; a colleague types "PR4444XQ". Comparing any two of those is meaningless, so normalisation happens ONCE, at the file drop, through the lists below — and everything downstream (specs, compare rules, filters, reports) sees one spelling.

## How a value is looked up

- Each list names the **raw keys** it reads (an ffprobe output of the File drop's ffprobe step) and, per entry, the spellings it accepts for each key, case-insensitively. A key an entry does not list is a wildcard; `pcm_`… means "starts with"; *(absent)* matches the key being missing.
- The **most specific** matching entry wins (the one listing the most keys): `codec h264` gathers every H.264 profile, while `codec prores` + `profile 4444 XQ` keeps ProRes profiles apart — for ProRes the profile *is* the deliverable.
- **No match → nothing is written**, never a guess. The raw value stays in its own column (`Container (raw)`, `Codec (raw)`…) and the drop says what the list is missing.

## Where the canonical name lands

The ffprobe step's canonical outputs can be mapped to:

- a **select** bound to the list (`options.vocabulary`) — its choices are these names, read from the code;
- a **text** field;
- a **link** to a table you maintain (Oct 17) — a *vocabulary table* such as Containers or Codecs, one row per name, with a `Name` and an optional `Aliases` column (key `aliases`, text or long text; one alias per line, or comma- or semicolon-separated). The drop links the row **named** the canonical name; else a row whose aliases include that name; else a row whose aliases include the raw spelling shown in the drop's notice (`prores / Something New`) or any single raw value. No row: no link, and a notice naming the spelling to add. A re-drop replaces the link, as it overwrites a select. A bound select's ⚙ → `convert to a link…` makes such a table from the list below, in one undoable step.

## Video codec (`video_codec`)

ffprobe output: `Codec`. Raw keys read: `codec`, `profile`.

| Canonical name | id | codec | profile |
|---|---|---|---|
| ProRes 4444 XQ | `prores_4444_xq` | `prores` | `4444 XQ` |
| ProRes 4444 | `prores_4444` | `prores` | `4444` |
| ProRes 422 HQ | `prores_422_hq` | `prores` | `HQ` |
| ProRes 422 | `prores_422` | `prores` | `Standard` |
| ProRes 422 LT | `prores_422_lt` | `prores` | `LT` |
| ProRes 422 Proxy | `prores_proxy` | `prores` | `Proxy` |
| ProRes RAW | `prores_raw` | `prores_raw` | *any* |
| DNxHR 444 | `dnxhr_444` | `dnxhd` | `DNxHR 444` |
| DNxHR HQX | `dnxhr_hqx` | `dnxhd` | `DNxHR HQX` |
| DNxHR HQ | `dnxhr_hq` | `dnxhd` | `DNxHR HQ` |
| DNxHR SQ | `dnxhr_sq` | `dnxhd` | `DNxHR SQ` |
| DNxHR LB | `dnxhr_lb` | `dnxhd` | `DNxHR LB` |
| DNxHD | `dnxhd` | `dnxhd` | *any* |
| H.264 | `h264` | `h264` | *any* |
| HEVC | `hevc` | `hevc` / `h265` | *any* |
| AV1 | `av1` | `av1` | *any* |
| VP9 | `vp9` | `vp9` | *any* |
| MPEG-2 | `mpeg2` | `mpeg2video` | *any* |
| MPEG-4 Part 2 | `mpeg4` | `mpeg4` | *any* |
| XDCAM HD422 | `xdcam` | `mpeg2video` | `4:2:2` |
| JPEG 2000 | `jpeg2000` | `jpeg2000` | *any* |
| CineForm | `cineform` | `cfhd` | *any* |
| FFV1 | `ffv1` | `ffv1` | *any* |
| Uncompressed | `uncompressed` | `rawvideo` / `v210` / `v410` / `r210` / `r10k` / `v308` / `yuv4` | *any* |
| OpenEXR | `exr` | `exr` | *any* |
| DPX | `dpx` | `dpx` | *any* |
| TIFF | `tiff` | `tiff` | *any* |
| PNG | `png` | `png` | *any* |
| JPEG | `jpeg` | `mjpeg` | *any* |
| Blackmagic RAW | `braw` | `braw` | *any* |
| REDCODE RAW | `redcode` | `redcode` | *any* |
| ARRIRAW | `arriraw` | `arriraw` | *any* |

## Audio codec (`audio_codec`)

ffprobe output: `Audio codec`. Raw keys read: `codec`.

| Canonical name | id | codec |
|---|---|---|
| PCM | `pcm` | `pcm_`… |
| AAC | `aac` | `aac` |
| Dolby Digital (AC-3) | `ac3` | `ac3` |
| Dolby Digital Plus (E-AC-3) | `eac3` | `eac3` |
| Dolby TrueHD | `truehd` | `truehd` |
| Dolby E | `dolby_e` | `dolby_e` |
| DTS | `dts` | `dts` |
| FLAC | `flac` | `flac` |
| ALAC | `alac` | `alac` |
| MP3 | `mp3` | `mp3` |
| MP2 | `mp2` | `mp2` |
| Opus | `opus` | `opus` |
| Vorbis | `vorbis` | `vorbis` |
| WMA | `wma` | `wmav1` / `wmav2` / `wmapro` / `wmalossless` |

## Container (`container`)

ffprobe output: `Container`. Raw keys read: `format`, `brand`, `extension`.

| Canonical name | id | format | brand | extension |
|---|---|---|---|---|
| QuickTime | `quicktime` | `mov,mp4,m4a,3gp,3g2,mj2` | `qt` / *(absent)* | *any* |
| MP4 | `mp4` | `mov,mp4,m4a,3gp,3g2,mj2` | `isom` / `iso2` / `iso4` / `iso5` / `iso6` / `mp41` / `mp42` / `mp71` / `avc1` / `m4v` / `m4a` / `dash` / `msnv` / `f4v` / `mp4v` / `hvc1` / `av01` | *any* |
| MXF | `mxf` | `mxf` | *any* | *any* |
| WAV | `wav` | `wav` | *any* | *any* |
| Wave64 | `w64` | `w64` | *any* | *any* |
| AIFF | `aiff` | `aiff` | *any* | *any* |
| FLAC | `flac` | `flac` | *any* | *any* |
| MP3 | `mp3` | `mp3` | *any* | *any* |
| AC-3 elementary | `ac3` | `ac3` | *any* | *any* |
| E-AC-3 elementary | `eac3` | `eac3` | *any* | *any* |
| Matroska | `matroska` | `matroska,webm` | *any* | `mkv` / `mka` / `mks` / `mk3d` |
| WebM | `webm` | `matroska,webm` | *any* | `webm` |
| AVI | `avi` | `avi` | *any* | *any* |
| MPEG-TS | `mpegts` | `mpegts` | *any* | *any* |
| MPEG-PS | `mpegps` | `mpeg` | *any* | *any* |
| Ogg | `ogg` | `ogg` | *any* | *any* |
| Image file(s) | `images` | `image2` / `image2pipe` / `exr_pipe` / `dpx_pipe` / `tiff_pipe` / `png_pipe` / `jpeg_pipe` / `bmp_pipe` / `webp_pipe` / `j2k_pipe` / `gif` | *any* | *any* |

## Colour primaries (`color_primaries`)

ffprobe output: `Primaries`. Raw keys read: `primaries`.

| Canonical name | id | primaries |
|---|---|---|
| Rec. 709 | `bt709` | `bt709` |
| Rec. 2020 | `bt2020` | `bt2020` |
| P3-D65 | `p3d65` | `smpte432` |
| P3-DCI | `p3dci` | `smpte431` |
| Rec. 601 (625) | `bt601_625` | `bt470bg` |
| Rec. 601 (525) | `bt601_525` | `smpte170m` |
| SMPTE 240M | `smpte240m` | `smpte240m` |
| NTSC 1953 (BT.470 M) | `bt470m` | `bt470m` |
| Film (Illuminant C) | `film` | `film` |
| XYZ (SMPTE 428) | `xyz` | `smpte428` |
| EBU 3213 | `ebu3213` | `jedec-p22` / `ebu3213` |

## Transfer function (`color_transfer`)

ffprobe output: `Transfer`. Raw keys read: `transfer`.

| Canonical name | id | transfer |
|---|---|---|
| Rec. 709 | `bt709` | `bt709` |
| PQ (SMPTE 2084) | `pq` | `smpte2084` |
| HLG | `hlg` | `arib-std-b67` |
| Rec. 2020 | `bt2020` | `bt2020-10` / `bt2020-12` |
| sRGB | `srgb` | `iec61966-2-1` |
| Linear | `linear` | `linear` |
| Rec. 601 | `bt601` | `smpte170m` |
| Gamma 2.2 | `gamma22` | `gamma22` / `bt470m` |
| Gamma 2.8 | `gamma28` | `gamma28` / `bt470bg` |
| SMPTE 240M | `smpte240m` | `smpte240m` |
| SMPTE 428 (DCDM) | `dcdm` | `smpte428` |
| Log | `log` | `log100` / `log316` |
| BT.1361 | `bt1361` | `bt1361e` |
| xvYCC | `xvycc` | `iec61966-2-4` |

## Colour matrix (`color_matrix`)

ffprobe output: `Matrix`. Raw keys read: `matrix`.

| Canonical name | id | matrix |
|---|---|---|
| Rec. 709 | `bt709` | `bt709` |
| Rec. 2020 (non-constant) | `bt2020nc` | `bt2020nc` |
| Rec. 2020 (constant) | `bt2020c` | `bt2020c` |
| ICtCp | `ictcp` | `ictcp` |
| Rec. 601 | `bt601` | `smpte170m` / `bt470bg` |
| RGB (identity) | `rgb` | `rgb` / `gbr` |
| YCgCo | `ycgco` | `ycgco` |
| FCC | `fcc` | `fcc` |
| SMPTE 240M | `smpte240m` | `smpte240m` |
| Chroma-derived | `chroma_derived` | `chroma-derived-nc` / `chroma-derived-c` |
