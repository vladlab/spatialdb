/**
 * Heading folding — in the EDITOR only, and only for the person folding.
 *
 * A chevron in the margin beside every top-level heading that has something under
 * it. Folded, the heading hides everything down to the next heading of its own
 * level or a higher one — so an H2 takes its H3s with it. Tab on a heading folds or
 * unfolds it; Shift+Tab folds every heading, or unfolds them all when all are
 * folded already (the canvas's Tab rule: any open → all fold, all folded → all open).
 *
 * A FOLD IS NOT AN EDIT. It is drawn with decorations, never written into the
 * document: folding does not make the note unsaved, is not in History, and does not
 * fold the note for a colleague. It is this browser's (localStorage), like every
 * other fold in the app — sections, the tray's block fields. The read-only renderer
 * (RichTextView: canvas cards) does not load this file and always shows a note whole.
 *
 * WHAT IS REMEMBERED. While the editor is open, a fold is a POSITION, carried
 * through every change — renaming a folded heading keeps it folded. Between visits
 * a position means nothing (the note may have been rewritten elsewhere), so what
 * is stored is a description: level, text, and which one of several alike. A fold
 * whose heading can no longer be found is forgotten, which shows as that section
 * being open. Nothing is ever lost by a fold going astray.
 *
 * YOU NEVER TYPE INTO WHAT YOU CANNOT SEE. If the cursor ends up inside a folded
 * section (an arrow key, a find, a colleague's save moving things), the sections
 * hiding it open. Folding a section the cursor is in moves the cursor up onto the
 * heading instead — as does a colleague's save that lands the cursor in a fold.
 *
 * Only TOP-LEVEL headings fold: one inside a quote or a table cell is that block's
 * content, and "down to the next heading" has no meaning in there.
 */
import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface Section {
  /** Where the heading node starts. */
  pos: number;
  level: number;
  /** The stored description: `level|text|n` — the n-th heading with that level and text. */
  key: string;
  /** The top-level nodes it hides when folded: [from, to) as indexes into the doc. */
  from: number; to: number;
  /** The end of the heading's text: where the cursor goes when its section is folded around it. */
  textEnd: number;
}

/** Every top-level heading, with what it would hide. One that would hide nothing is still listed (from === to). */
export function sectionsOf(doc: PMNode): Section[] {
  const out: Section[] = [];
  const seen = new Map<string, number>();
  const open: Section[] = [];            // headings whose section has not ended yet
  doc.forEach((node, pos, index) => {
    if (node.type.name !== 'heading') return;
    const level = Number(node.attrs.level) || 1;
    while (open.length && open[open.length - 1].level >= level) open.pop()!.to = index;
    const base = `${level}|${node.textContent.trim()}`;
    const n = seen.get(base) ?? 0; seen.set(base, n + 1);
    const s: Section = { pos, level, key: `${base}|${n}`, from: index + 1, to: doc.childCount, textEnd: pos + node.nodeSize - 1 };
    out.push(s); open.push(s);
  });
  return out;
}

/* ── what this browser remembers ── */
const STORE_KEY = 'spatialdb.rte.headingFolds';
type Stored = Record<string, string[]>;
function readStored(): Stored {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Stored) : {};
  } catch { return {}; }
}
/** The folds remembered for one note (`noteKey` = record + field). */
export function storedFolds(noteKey: string): string[] {
  const v = readStored()[noteKey];
  return Array.isArray(v) ? v.filter((k) => typeof k === 'string') : [];
}
function storeFolds(noteKey: string, keys: string[]) {
  try {
    const all = readStored();
    if (keys.length) all[noteKey] = keys; else delete all[noteKey];
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch { /* kept for this page only */ }
}

/* ── the plugin ── */
interface FoldState { folded: number[]; deco: DecorationSet }
type Meta = { toggle: number } | { all: boolean };
export const foldKey = new PluginKey<FoldState>('headingFolds');

const foldedKeys = (doc: PMNode, folded: number[]) => sectionsOf(doc).filter((s) => folded.includes(s.pos)).map((s) => s.key);

function chevron(folded: boolean): HTMLElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'fold-chevron'; b.tabIndex = -1; b.contentEditable = 'false';
  b.title = folded ? 'Unfold this section (Tab)' : 'Fold this section (Tab) — Shift+Tab folds or unfolds them all';
  b.setAttribute('aria-expanded', String(!folded));
  b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${folded ? 'M6 3.5 10.5 8 6 12.5' : 'M3.5 6 8 10.5 12.5 6'}" /></svg>`;
  return b;
}

function decorate(doc: PMNode, folded: number[]): DecorationSet {
  const decos: Decoration[] = [];
  const hidden = new Set<number>();
  for (const s of sectionsOf(doc)) {
    if (s.from === s.to) continue;                       // nothing under it: nothing to fold
    const isFolded = folded.includes(s.pos);
    const node = doc.nodeAt(s.pos)!;
    decos.push(Decoration.node(s.pos, s.pos + node.nodeSize, { class: isFolded ? 'fold-head folded' : 'fold-head' }));
    // `key` carries the state, so the button is rebuilt exactly when it changes — and
    // NOT when its heading merely moves, which is why it does not carry a position.
    decos.push(Decoration.widget(s.pos + 1, () => chevron(isFolded), { side: -1, key: `fold-${isFolded ? 'f' : 'o'}`, ignoreSelection: true }));
    if (isFolded) for (let i = s.from; i < s.to; i++) hidden.add(i);
  }
  doc.forEach((node, pos, index) => { if (hidden.has(index)) decos.push(Decoration.node(pos, pos + node.nodeSize, { class: 'fold-hidden' })); });
  return DecorationSet.create(doc, decos);
}

/** The folded headings (outermost first) whose section holds top-level node `index`. */
const hiding = (secs: Section[], folded: number[], index: number) => secs.filter((s) => folded.includes(s.pos) && index >= s.from && index < s.to);

/** The fold/unfold as a transaction: sets the meta, and lifts the cursor onto the heading if its section is closing around it. */
function foldTr(state: EditorState, meta: Meta): Transaction {
  const tr = state.tr.setMeta(foldKey, meta).setMeta('addToHistory', false);
  const secs = sectionsOf(state.doc);
  const now = foldKey.getState(state)?.folded ?? [];
  const next = 'all' in meta ? (meta.all ? secs.filter((s) => s.from < s.to).map((s) => s.pos) : [])
    : now.includes(meta.toggle) ? now.filter((p) => p !== meta.toggle) : [...now, meta.toggle];
  const over = hiding(secs, next, state.selection.$head.index(0))[0];
  if (over) tr.setSelection(TextSelection.create(state.doc, over.textEnd));
  return tr;
}

export interface FoldOptions { noteKey: string }

export const HeadingFolds = Extension.create<FoldOptions>({
  name: 'headingFolds',
  addOptions() { return { noteKey: '' }; },

  addProseMirrorPlugins() {
    const noteKey = this.options.noteKey;
    return [new Plugin<FoldState>({
      key: foldKey,
      state: {
        init: (_config, state) => {
          const want = new Set(storedFolds(noteKey));
          const folded = sectionsOf(state.doc).filter((s) => want.has(s.key) && s.from < s.to).map((s) => s.pos);
          return { folded, deco: decorate(state.doc, folded) };
        },
        apply(tr, prev, oldState, newState) {
          const meta = tr.getMeta(foldKey) as Meta | undefined;
          if (!meta && !tr.docChanged && !tr.selectionSet) return prev;
          let folded = prev.folded;
          if (tr.docChanged) {
            // Carry each fold through the change; one whose heading did not survive as
            // a heading (the whole note was replaced: a colleague's save, Escape) is
            // looked for again by its description.
            const oldKeys = new Map(sectionsOf(oldState.doc).map((s) => [s.pos, s.key]));
            const secs = sectionsOf(newState.doc);
            folded = folded.flatMap((pos) => {
              const m = tr.mapping.mapResult(pos, 1);
              if (!m.deleted && newState.doc.nodeAt(m.pos)?.type.name === 'heading' && newState.doc.resolve(m.pos).depth === 0) return [m.pos];
              const again = secs.find((s) => s.key === oldKeys.get(pos));
              return again ? [again.pos] : [];
            });
            folded = [...new Set(folded)];
          }
          const secs = sectionsOf(newState.doc);
          if (meta) {
            if ('all' in meta) folded = meta.all ? secs.filter((s) => s.from < s.to).map((s) => s.pos) : [];
            else folded = folded.includes(meta.toggle) ? folded.filter((p) => p !== meta.toggle) : [...folded, meta.toggle];
          }
          // The cursor is never left inside what is hidden: whatever hides it opens. Unless
          // the note was REPLACED under it (a colleague's save, Escape — `preventUpdate`
          // is how the editor marks those): the cursor did not go there, it was put
          // there, so the fold stays and the cursor is lifted out (appendTransaction).
          if (!tr.getMeta('preventUpdate')) {
            const over = hiding(secs, folded, newState.selection.$head.index(0)).map((s) => s.pos);
            if (over.length) folded = folded.filter((p) => !over.includes(p));
          }
          const same = folded.length === prev.folded.length && folded.every((p, i) => p === prev.folded[i]);
          return same && !tr.docChanged ? prev : { folded, deco: decorate(newState.doc, folded) };
        },
      },
      appendTransaction(_trs, _old, state) {
        const over = hiding(sectionsOf(state.doc), foldKey.getState(state)?.folded ?? [], state.selection.$head.index(0))[0];
        return over ? state.tr.setSelection(TextSelection.create(state.doc, over.textEnd)).setMeta('preventUpdate', true).setMeta('addToHistory', false) : null;
      },
      props: {
        decorations(state) { return foldKey.getState(state)?.deco; },
        handleDOMEvents: {
          // mousedown, not click: the editor must not take the press as "put the cursor here".
          mousedown(view, event) {
            const btn = (event.target as HTMLElement | null)?.closest?.('.fold-chevron') as HTMLElement | null;
            if (!btn) return false;
            event.preventDefault();
            const $in = view.state.doc.resolve(view.posAtDOM(btn, 0));      // somewhere inside its heading
            if ($in.depth < 1) return true;
            view.dispatch(foldTr(view.state, { toggle: $in.before(1) }));
            return true;
          },
        },
      },
      view() {
        return {
          update(view, prevState) {
            if (!noteKey) return;
            const now = foldedKeys(view.state.doc, foldKey.getState(view.state)?.folded ?? []);
            const was = foldedKeys(prevState.doc, foldKey.getState(prevState)?.folded ?? []);
            if (now.join('\n') !== was.join('\n')) storeFolds(noteKey, now);
          },
        };
      },
    })];
  },

  addKeyboardShortcuts() {
    /** Inside a list or a table Tab and Shift+Tab already mean something (indent, next cell). */
    const busy = (state: EditorState) => {
      const $f = state.selection.$from;
      for (let d = $f.depth; d > 0; d--) if (['listItem', 'taskItem', 'table'].includes($f.node(d).type.name)) return true;
      return false;
    };
    return {
      Tab: ({ editor }) => {
        const { state } = editor;
        const $f = state.selection.$from;
        if ($f.depth !== 1 || $f.parent.type.name !== 'heading') return false;
        const s = sectionsOf(state.doc).find((x) => x.pos === $f.before(1));
        // On a heading Tab is always "fold": with nothing under it, it does nothing —
        // rather than sometimes folding and sometimes throwing the focus out of the note.
        if (s && s.from < s.to) editor.view.dispatch(foldTr(state, { toggle: s.pos }));
        return true;
      },
      'Shift-Tab': ({ editor }) => {
        const { state } = editor;
        if (busy(state)) return false;
        const can = sectionsOf(state.doc).filter((s) => s.from < s.to);
        if (!can.length) return false;
        const folded = foldKey.getState(state)?.folded ?? [];
        editor.view.dispatch(foldTr(state, { all: !can.every((s) => folded.includes(s.pos)) }));
        return true;
      },
    };
  },
});
