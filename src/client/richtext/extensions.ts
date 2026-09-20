/**
 * The TipTap extension set — ONE list, used by the editor and by the read-only
 * renderer, so a document can never look different being read than being written.
 *
 * Ported from viznotes (NoteTextSection.vue / extensions/TiptapImage.ts), minus
 * what that app needed and this one does not: tiptap-markdown (values here are
 * JSON, not markdown — pasted email HTML, tables especially, does not survive the
 * round trip), text-align, and the vault-path image resolver.
 *
 * THE IMAGE NODE is the part that matters. It stores an ASSET ID and nothing else
 * that could locate the file:
 *
 *     { type: 'image', attrs: { assetId, width, height, alt } }
 *
 * The `src` is BUILT at render time from the id. That is what keeps documents
 * small enough to live in a mutation log (contract/richtext.ts refuses a `src` or
 * a data: URI outright), and it means the same stored document works whatever
 * address the server is reached at — the browser through a proxy today, the
 * Tauri client tomorrow. `width`/`height` come from the asset's metadata so the
 * page can reserve the space before the image arrives and nothing jumps.
 */

import { mergeAttributes, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';

export function assetImage(assetUrl: (id: string) => string) {
  return Node.create({
    name: 'image',
    group: 'block',
    atom: true,
    draggable: true,
    addAttributes() {
      return {
        // `rendered: false`: renderHTML below writes every attribute itself. Left to
        // TipTap, `assetId` would also be emitted verbatim as an HTML attribute.
        assetId: { default: null, rendered: false },
        width: { default: null, rendered: false },
        height: { default: null, rendered: false },
        alt: { default: null, rendered: false },
      };
    },
    // Only our own rendering parses back into an image. A pasted <img src="https://…">
    // or <img src="data:…"> deliberately does NOT: the paste handler deals with
    // those (uploading what it can), and anything it could not must not slip in as
    // a node the server will then refuse.
    parseHTML() {
      return [{
        tag: 'img[data-asset-id]',
        getAttrs: (el) => {
          const e = el as HTMLElement;
          return {
            assetId: e.getAttribute('data-asset-id'),
            width: Number(e.getAttribute('width')) || null,
            height: Number(e.getAttribute('height')) || null,
            alt: e.getAttribute('alt'),
          };
        },
      }];
    },
    renderHTML({ node, HTMLAttributes }) {
      const { assetId, width, height, alt } = node.attrs as { assetId: string | null; width: number | null; height: number | null; alt: string | null };
      return ['img', mergeAttributes(HTMLAttributes, {
        src: assetId ? assetUrl(assetId) : '',
        'data-asset-id': assetId,
        ...(width ? { width } : {}), ...(height ? { height } : {}),
        alt: alt ?? '', loading: 'lazy',
      })];
    },
  });
}

export function richExtensions(assetUrl: (id: string) => string, placeholder = '') {
  return [
    StarterKit.configure({
      // Links are kept (emails are full of them) but never followed by a click
      // inside the editor, and only http(s)/mailto/tel are allowed — the server
      // refuses anything else (contract/richtext.ts).
      link: { openOnClick: false, autolink: true, protocols: ['http', 'https', 'mailto', 'tel'] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    // Tables: pasted emails and spec sheets are made of them. Not resizable —
    // column-drag handles are a lot of machinery for notes.
    TableKit.configure({ table: { resizable: false } }),
    assetImage(assetUrl),
    ...(placeholder ? [Placeholder.configure({ placeholder })] : []),
  ];
}
