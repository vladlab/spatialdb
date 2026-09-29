/**
 * Fuzzy matching for SHORT lists held in memory — table names in the command
 * palette. Not used for records: those are searched on the server (reads.ts),
 * because a subsequence match cannot be indexed and the client does not hold
 * every table.
 *
 * `fuzzyScore` is the fzf idea, kept small: the query's characters must appear
 * in the text in order (a subsequence); the score rewards matches at the start
 * of the text, at the start of a word, and runs of consecutive characters. So
 * "edit" ranks "Edits" far above "Elvis Isn't Dead... iT" — both match, one is
 * what you meant. 0 means no match.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase(), t = text.toLowerCase();
  if (!q) return 1;
  let score = 0, ti = 0, run = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const found = t.indexOf(q[qi], ti);
    if (found === -1) return 0;
    const wordStart = found === 0 || /[^a-z0-9]/.test(t[found - 1]);
    run = found === ti && qi > 0 ? run + 1 : 0;
    score += 1 + (found === 0 ? 8 : 0) + (wordStart ? 4 : 0) + run * 3;
    // A long way to the next character is a weak match; charge for the gap.
    score -= Math.min(3, (found - ti) * 0.25);
    ti = found + 1;
  }
  // Prefer the shorter of two otherwise-equal matches ("Edits" over "Edit notes").
  return Math.max(0.01, score - t.length * 0.01);
}

export function fuzzyRank<T>(query: string, items: T[], text: (x: T) => string): T[] {
  return items
    .map((item) => ({ item, s: fuzzyScore(query, text(item)) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}

/**
 * `table:query`. The part before the FIRST colon scopes the search to tables
 * whose name it fuzzy-matches — but only if it matches at least one; otherwise
 * the colon is just a character ("12:30 call" is a search for that text).
 */
export function parsePaletteQuery<T>(
  input: string, tables: T[], name: (t: T) => string,
): { tables: T[]; text: string; scoped: boolean } {
  const colon = input.indexOf(':');
  if (colon > 0) {
    const matched = fuzzyRank(input.slice(0, colon).trim(), tables, name);
    if (matched.length) return { tables: matched, text: input.slice(colon + 1).trim(), scoped: true };
  }
  return { tables: [], text: input.trim(), scoped: false };
}

/**
 * Ranking CHOICES against what was typed — for the select picker. Every candidate
 * that matches gets a score; higher is better; non-matches are dropped:
 *
 *   exact (case-insensitive)      1000
 *   starts with the query          800 − length
 *   every term is a substring      600 − position of the first
 *   subsequence ("prs4" ⊂ "ProRes 4444")   200 − gap count
 *
 * Ties: a TIGHTER match first (the typed letters closer together — "dn" is done
 * before doing), then the shorter choice, then the list's own order (a select's
 * choices are ordered by hand). Small on purpose: choices are a few dozen strings
 * already in memory; the link picker has its own server-side search.
 */
export function rankChoices(query: string, choices: readonly string[]): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...choices];
  const terms = q.split(/\s+/).filter(Boolean);
  const scored: Array<{ c: string; s: number; span: number; i: number }> = [];
  choices.forEach((c, i) => {
    const l = c.toLowerCase();
    let s = -1, span = 0;
    if (l === q) s = 1000;
    else if (l.startsWith(q)) s = 800 - l.length;
    else if (terms.every((t) => l.includes(t))) s = 600 - l.indexOf(terms[0]);
    else {
      const chars = q.replace(/\s+/g, '');
      let pos = 0, gaps = 0, first = -1, last = -1;
      for (const ch of chars) {
        const at = l.indexOf(ch, pos);
        if (at < 0) { pos = -1; break; }
        if (first < 0) first = at;
        if (last >= 0 && at > last + 1) gaps++;
        last = at; pos = at + 1;
      }
      if (pos >= 0 && chars.length >= 2) { s = 200 - gaps; span = last - first; }
    }
    if (s >= 0) scored.push({ c, s, span, i });
  });
  return scored.sort((a, b) => b.s - a.s || a.span - b.span || a.c.length - b.c.length || a.i - b.i).map((x) => x.c);
}
