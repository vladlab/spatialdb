/**
 * Getting pasted and dropped images INTO the asset store.
 *
 * Three things arrive on a clipboard, and each needs different handling:
 *
 *  1. IMAGE FILES — a screenshot (Print Screen, a snipping tool), or files copied
 *     from a file manager. Uploaded; an image node is inserted per file.
 *  2. HTML WITH EMBEDDED IMAGES — `<img src="data:image/png;base64,…">`, which is
 *     how some mail clients and most "copy from a web page" put inline pictures on
 *     the clipboard. Each is decoded, uploaded, and the tag rewritten to refer to
 *     the asset — so the pasted email keeps its pictures, in place.
 *  3. HTML WITH LINKED IMAGES — `<img src="https://…">` or `cid:…`. These live on
 *     someone else's server (or inside a mail file) and the browser will not let
 *     this page read their bytes. They are DROPPED, and the caller is told how
 *     many, so the editor can say so instead of silently losing them. The fix for
 *     the person is a screenshot, which is case 1.
 *
 * Returns HTML that contains only asset-backed images, ready for insertContent.
 */

import type { AssetMeta } from '../store';

export type Upload = (file: Blob, name?: string) => Promise<AssetMeta>;

export const imageTag = (a: AssetMeta) =>
  `<img data-asset-id="${a.id}"${a.width ? ` width="${a.width}"` : ''}${a.height ? ` height="${a.height}"` : ''} alt="${(a.name || '').replace(/"/g, '&quot;')}">`;

export function imageFilesOf(data: DataTransfer | null): File[] {
  if (!data) return [];
  const files = [...data.files].filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
  if (files.length) return files.filter((f) => f.type.startsWith('image/'));
  // Some sources expose the image only as an item, not in `files`.
  return [...data.items].filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile()).filter((f): f is File => !!f);
}

function dataUriToBlob(uri: string): Blob | null {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(uri);
  if (!m) return null;
  try {
    const bytes = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : new TextEncoder().encode(decodeURIComponent(m[3]));
    return new Blob([bytes], { type: m[1] || 'application/octet-stream' });
  } catch { return null; }
}

export async function adoptImagesInHtml(html: string, upload: Upload): Promise<{ html: string; dropped: number; failed: number }> {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let dropped = 0, failed = 0;
  for (const img of [...doc.querySelectorAll('img')]) {
    const src = img.getAttribute('src') ?? '';
    if (img.hasAttribute('data-asset-id')) continue;             // already ours (copied from another note)
    const blob = src.startsWith('data:') ? dataUriToBlob(src) : null;
    if (!blob) { dropped++; img.remove(); continue; }
    try {
      const a = await upload(blob, img.getAttribute('alt') || 'pasted image');
      const holder = doc.createElement('div');
      holder.innerHTML = imageTag(a);
      img.replaceWith(holder.firstElementChild!);
    } catch { failed++; img.remove(); }
  }
  return { html: doc.body.innerHTML, dropped, failed };
}
