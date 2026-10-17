/**
 * VOCABULARIES.md, generated from src/contract/vocab.ts — the raw → canonical
 * dictionary as a page anyone can read without reading TypeScript. Run with
 * `npm run vocab:doc`; test/tools.ts fails when the page is behind the code, so
 * the page cannot drift. Hand edits here are lost on the next run: the lists
 * live in the code, this is their rendering.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { VOCABULARY_TABLES } from '../src/contract/vocab.js';
import { ANALYZERS } from '../src/contract/tools.js';

const spell = (v: string | readonly string[]) => (typeof v === 'string' ? [v] : [...v]).map((s) => (s === '' ? '*(absent)*' : s.endsWith('*') ? `\`${s.slice(0, -1)}\`…` : `\`${s}\``)).join(' / ');

export function vocabularyDoc(): string {
  const ffprobe = ANALYZERS.find((a) => a.id === 'ffprobe')!;
  const out: string[] = [];
  out.push('# Vocabularies — raw ffprobe output → one canonical name', '',
    '*Generated from `src/contract/vocab.ts` by `npm run vocab:doc`. Do not edit by hand; edit the code and re-run (test/tools.ts fails while this page is behind).*', '',
    'ffprobe says `prores` / `4444 XQ`; a spec says "Apple ProRes 4444 XQ"; a colleague types "PR4444XQ". Comparing any two of those is meaningless, so normalisation happens ONCE, at the file drop, through the lists below — and everything downstream (specs, compare rules, filters, reports) sees one spelling.', '',
    '## How a value is looked up', '',
    '- Each list names the **raw keys** it reads (an ffprobe output of the File drop\'s ffprobe step) and, per entry, the spellings it accepts for each key, case-insensitively. A key an entry does not list is a wildcard; `pcm_`… means "starts with"; *(absent)* matches the key being missing.',
    '- The **most specific** matching entry wins (the one listing the most keys): `codec h264` gathers every H.264 profile, while `codec prores` + `profile 4444 XQ` keeps ProRes profiles apart — for ProRes the profile *is* the deliverable.',
    '- **No match → nothing is written**, never a guess. The raw value stays in its own column (`Container (raw)`, `Codec (raw)`…) and the drop says what the list is missing.', '',
    '## Where the canonical name lands', '',
    'The ffprobe step\'s canonical outputs can be mapped to:', '',
    '- a **select** bound to the list (`options.vocabulary`) — its choices are these names, read from the code;',
    '- a **text** field;',
    '- a **link** to a table you maintain (Oct 17) — a *vocabulary table* such as Containers or Codecs, one row per name, with a `Name` and an optional `Aliases` column (key `aliases`, text or long text; one alias per line, or comma- or semicolon-separated). The drop links the row **named** the canonical name; else a row whose aliases include that name; else a row whose aliases include the raw spelling shown in the drop\'s notice (`prores / Something New`) or any single raw value. No row: no link, and a notice naming the spelling to add. A re-drop replaces the link, as it overwrites a select. A bound select\'s ⚙ → `convert to a link…` makes such a table from the list below, in one undoable step.', '',
  );
  out.push('## Reading the transfer list', '',
    '- `bt709` (H.273 code 1) is the Rec. 709 **OETF**, the camera-side curve; BT.1886 is the **EOTF** of the reference display (gamma 2.4). There is no "bt1886" tag — a file meant for BT.1886 display is tagged bt709, and that tag is read as "SDR video gamma". One entry, "Rec. 709", covers both; name your own row "Rec. 709 (BT.1886)" and alias it `Rec. 709` if you prefer.',
    '- `bt2020-10` / `bt2020-12` (codes 14/15) are the Rec. 2020 **SDR** curve — numerically Rec. 709\'s, specified at 10/12-bit precision. They are not HDR. HDR is BT.2100: PQ (`smpte2084`, code 16) and HLG (`arib-std-b67`, code 18). So "Rec. 2020" and "PQ" are rightly two entries.',
    '- Gamma 2.4 is not in the list because H.273 has no code for it (only 2.2 and 2.8): ffprobe can never report it; such a file arrives tagged bt709. A spec can still say it — add a "Gamma 2.4" row to your Transfer table; nothing lands on it by drop, you pick it on the spec.', '');
  for (const [id, v] of Object.entries(VOCABULARY_TABLES)) {
    const outs = ffprobe.outputs.filter((o) => o.vocabulary === id).map((o) => `\`${o.name}\``).join(', ');
    out.push(`## ${v.name} (\`${id}\`)`, '', `ffprobe output${outs.includes(',') ? 's' : ''}: ${outs}. Raw keys read: ${v.keys.map((k) => `\`${k}\``).join(', ')}.`, '',
      `| Canonical name | id | ${v.keys.join(' | ')} |`, `|---|---|${v.keys.map(() => '---').join('|')}|`);
    for (const e of v.entries) out.push(`| ${e.name} | \`${e.id}\` | ${v.keys.map((k) => (k in e.raw ? spell(e.raw[k]) : '*any*')).join(' | ')} |`);
    out.push('');
  }
  return out.join('\n');
}

const here = dirname(fileURLToPath(import.meta.url));
export const DOC_PATH = join(here, '..', 'VOCABULARIES.md');
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  writeFileSync(DOC_PATH, vocabularyDoc());
  console.log(`wrote ${DOC_PATH}`);
}
