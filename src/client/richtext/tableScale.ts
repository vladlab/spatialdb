/**
 * A table's SCALE — pasted tables (an email's spec sheet) often arrive huge.
 *
 * Stored on the table node (`attrs.scale`: 0.6 … 0.9, or null for full size), so it
 * is part of the note: it saves, and everyone — and every canvas card — sees the
 * table at the size it was set to. Only ever SMALLER than the text around it: too
 * big is the problem, and a table larger than its note is not a thing to offer.
 *
 * Rendered as `data-scale` plus a `--tbl-scale` custom property; the look (text and
 * cell padding shrinking together) is CSS, in App.vue with the other rich text rules.
 * A pasted table starts at full size: guessing a "fit" on paste guesses wrong often.
 *
 * TWO renderings, one look. Read-only (RichTextView: canvas cards) the attributes
 * are written on the <table> by `renderHTML` below. In the EDITOR TipTap draws a
 * table through its own node view — a `div.tableWrapper` around the table, built
 * once and not redrawn from the node's attributes — so there the same two
 * attributes are put on the wrapper by a decoration. The CSS matches either.
 */
import { Extension, type Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export const TABLE_SCALES = [0.6, 0.7, 0.8, 0.9, 1] as const;
const scaleAttrs = (s: number) => ({ 'data-scale': String(s), style: `--tbl-scale: ${s}` });
function decorate(doc: PMNode): DecorationSet {
  const decos: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;
    const s = valid(node.attrs.scale);
    if (s) decos.push(Decoration.node(pos, pos + node.nodeSize, scaleAttrs(s)));
    return true;                       // a table in a cell of a table is still a table
  });
  return DecorationSet.create(doc, decos);
}
const scaleKey = new PluginKey<DecorationSet>('tableScale');

const valid = (v: unknown): number | null => (typeof v === 'number' && TABLE_SCALES.includes(v as 1) && v < 1 ? v : null);

export const TableScale = Extension.create({
  name: 'tableScale',
  addGlobalAttributes() {
    return [{
      types: ['table'],
      attributes: {
        scale: {
          default: null,
          parseHTML: (el) => valid(Number(el.getAttribute('data-scale'))),
          renderHTML: (attrs) => {
            const s = valid(attrs.scale);
            return s ? scaleAttrs(s) : {};
          },
        },
      },
    }];
  },
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: scaleKey,
      state: {
        init: (_c, state) => decorate(state.doc),
        apply: (tr, prev, _old, state) => (tr.docChanged ? decorate(state.doc) : prev),
      },
      props: { decorations(state) { return scaleKey.getState(state); } },
    })];
  },
});

/** The table the cursor is in: where it starts, and its scale (1 = full size). Null outside a table. */
export function tableAtCursor(editor: Editor | undefined): { pos: number; scale: number } | null {
  if (!editor) return null;
  const $f = editor.state.selection.$from;
  for (let d = $f.depth; d > 0; d--) {
    const n = $f.node(d);
    if (n.type.name === 'table') return { pos: $f.before(d), scale: valid(n.attrs.scale) ?? 1 };
  }
  return null;
}

/** One step smaller (-1) or larger (+1), within 60%–100%. False when there is no table or no step left. */
export function stepTableScale(editor: Editor | undefined, dir: -1 | 1): boolean {
  const t = tableAtCursor(editor);
  if (!editor || !t) return false;
  const next = TABLE_SCALES[TABLE_SCALES.indexOf(t.scale as 1) + dir];
  if (next === undefined) return false;
  const node = editor.state.doc.nodeAt(t.pos)!;
  editor.view.dispatch(editor.state.tr.setNodeMarkup(t.pos, undefined, { ...node.attrs, scale: next < 1 ? next : null }));
  editor.commands.focus();
  return true;
}
