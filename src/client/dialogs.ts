/**
 * The app's own dialogs — instead of the browser's `prompt()` and `confirm()`.
 *
 * The native ones look like the operating system rather than the app, cannot hold
 * anything but one line of text (the new-table dialog needs a checkbox), block
 * the whole page — the stream included — while they are open, and Tauri's webview
 * does not reliably show them at all.
 *
 *     const name = await ask({ title: 'New canvas', label: 'Name' });        // string | null
 *     if (await confirmDialog({ title: 'Delete table?', body, danger: true })) …
 *
 * They are ASYNC where the native ones were synchronous, so every caller awaits.
 * One consequence worth knowing: mutations made after an `await` are in a later
 * tick than the ones before it, and an undo step is "one synchronous run"
 * (store.ts). So ask first, THEN mutate — never mutate, ask, mutate.
 *
 * One dialog at a time, queued. App.vue mounts <DialogHost/>, which renders
 * whatever is at the head of the queue.
 */

import { reactive } from 'vue';

export interface AskOptions {
  title: string;
  label?: string;
  initial?: string;
  placeholder?: string;
  /** Hide what is typed (and keep it out of the browser's form history). */
  password?: boolean;
  okText?: string;
  /** Extra tick boxes under the text field; their values come back in `checks`. */
  checkboxes?: Array<{ key: string; label: string; hint?: string; initial?: boolean }>;
  /** A choice to make as well as (or instead of) a name. */
  select?: { label: string; options: Array<{ value: string; label: string }>; initial?: string };
  /** No text field at all — just the select and/or checkboxes. */
  noText?: boolean;
}
export interface AskResult { value: string; checks: Record<string, boolean>; choice: string }

export interface ConfirmOptions { title: string; body?: string; okText?: string; danger?: boolean }

type Pending =
  | { kind: 'ask'; opts: AskOptions; resolve: (r: AskResult | null) => void }
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (ok: boolean) => void };

export const dialogQueue = reactive<Pending[]>([]);

/** Full result, for dialogs with checkboxes or a select. Null = cancelled. */
export function askFull(opts: AskOptions): Promise<AskResult | null> {
  return new Promise((resolve) => { dialogQueue.push({ kind: 'ask', opts, resolve }); });
}
/** The common case: one trimmed line of text, or null if cancelled or left empty. */
export async function ask(opts: AskOptions): Promise<string | null> {
  const r = await askFull(opts);
  const v = r?.value.trim();
  return v ? v : null;
}
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => { dialogQueue.push({ kind: 'confirm', opts, resolve }); });
}

/** Called by DialogHost. */
export function settle(result: AskResult | boolean | null) {
  const d = dialogQueue.shift();
  if (!d) return;
  if (d.kind === 'confirm') d.resolve(result === true);
  else d.resolve(result && typeof result === 'object' ? result : null);
}
