<!--
  SETTINGS — opened from the footer of the navigation tree.

  Its first tenant is HISTORY, which used to be a top-level tab. It was demoted,
  not removed, because it does something Ctrl+Z cannot: Ctrl+Z is THIS session and
  THIS person — reload, and its stack is gone; a colleague's delete was never on
  it. History is the server's record of every delete, with what it destroyed
  captured, restorable by anyone with the right role, days later. You will rarely
  need it; when you do, the alternative is a backup restore.

  Things that are about the whole app and not about a table, a section or a canvas
  belong here as they arrive (each of those has its own ⚙).
-->
<template>
  <div class="set-backdrop" @mousedown.self="$emit('close')">
    <div class="settings" role="dialog" aria-modal="true" @keydown.stop="onKey">
      <header><h2>Settings</h2><button class="x" title="Close (Esc)" @click="$emit('close')">×</button></header>

      <section v-if="me" class="account">
        <h3>You</h3>
        <p class="who"><b>{{ me.name || me.email }}</b> <span class="muted">{{ me.email }} · {{ me.role }}</span></p>
        <p v-if="store.authDisabled.value" class="note warn">Sign-in is switched OFF on this server (AUTH_DISABLED=1): everyone is this user. Development only.</p>
        <div class="line">
          <button class="plain change-password" @click="changePassword">Change password…</button>
          <button class="plain sign-out" @click="signOut">Sign out</button>
        </div>
        <p v-if="accountNote" class="note" :class="{ warn: accountBad }">{{ accountNote }}</p>
      </section>

      <section v-if="me?.role === 'admin'" class="users">
        <h3>Users</h3>
        <p class="note">
          Admins change the schema, sections and users. Editors change data. Viewers only look. People are never deleted —
          the history of who did what has to outlive their access — they are <i>disabled</i>, which signs them out at once.
        </p>
        <table class="hist">
          <tbody>
            <tr v-for="u in users" :key="u.id" :class="{ done: u.disabled }">
              <td class="what">{{ u.name || '—' }} <span class="muted">{{ u.email }}</span><span v-if="u.id === me.id" class="you"> you</span></td>
              <td>
                <select class="role" :value="u.role" :disabled="u.disabled" @change="patchUser(u.id, { role: ($event.target as HTMLSelectElement).value })">
                  <option>admin</option><option>editor</option><option>viewer</option>
                </select>
              </td>
              <td class="muted when">{{ u.disabled ? 'disabled' : u.last_seen ? 'seen ' + when(u.last_seen) : u.has_password ? 'never signed in' : 'no password' }}</td>
              <td class="do">
                <button class="plain" @click="resetPassword(u.id, u.name || u.email)">set password…</button>
                <button class="plain" :class="{ danger: !u.disabled }" @click="patchUser(u.id, { disabled: !u.disabled })">{{ u.disabled ? 'enable' : 'disable' }}</button>
              </td>
            </tr>
          </tbody>
        </table>
        <form class="add-user" @submit.prevent="addUser">
          <input v-model="nu.name" placeholder="name" />
          <input v-model="nu.email" type="email" placeholder="email" required />
          <select v-model="nu.role"><option>editor</option><option>viewer</option><option>admin</option></select>
          <input v-model="nu.password" type="password" autocomplete="new-password" placeholder="a first password (10+)" required />
          <button class="plain" type="submit">add user</button>
        </form>
        <p v-if="usersNote" class="note warn">{{ usersNote }}</p>
      </section>

      <section class="history">
        <h3>History — restore something deleted</h3>
        <p class="note">
          Every delete, by anyone, with everything it took with it. For undoing what you just did, Ctrl+Z is quicker —
          it also covers moves, edits and links, which are not listed here. This list is for what Ctrl+Z has forgotten:
          after a reload, from another day, or deleted by someone else.
        </p>
        <table class="hist">
          <tbody>
            <tr v-for="u in list" :key="u.id" :class="{ done: u.undone_by }">
              <td class="what">{{ LABEL[u.type] ?? u.type }}</td>
              <td class="muted">{{ describe(u.counts) }}</td>
              <td class="muted when">{{ u.actor_name ? u.actor_name + " · " : "" }}{{ when(u.applied_at) }}</td>
              <td class="do">
                <button v-if="!u.undone_by && !u.truncated" class="restore" @click="restore(u.id)">restore</button>
                <span v-else-if="u.truncated" class="muted" title="Too large to capture — restore from a backup">too large</span>
                <span v-else class="muted">restored</span>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-if="!list.length" class="muted">Nothing has been deleted.</p>
      </section>

      <section>
        <h3>About this connection</h3>
        <p class="note">{{ store.streamState.value }} · change {{ store.lastSeq.value }}</p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import { askFull } from '../dialogs';
import type { Store } from '../store';

const props = defineProps<{ store: Store }>();
const emit = defineEmits<{ close: [] }>();

/* ── you, and (for admins) everyone else ───────────────────────────────────
   None of this is a mutation: credentials must not enter the log or the stream
   (server/index.ts). So it is plain request/response, fetched when this opens. */
const me = computed(() => props.store.me.value);
const accountNote = ref(''); const accountBad = ref(false);
async function changePassword() {
  const current = await askFull({ title: 'Your current password', label: 'Current password', password: true, okText: 'Next' });
  if (!current?.value) return;
  const next = await askFull({ title: 'Your new password', label: 'New password — at least 10 characters', password: true, okText: 'Change password' });
  if (!next?.value) return;
  const r = await props.store.call('POST', '/api/auth/password', { current: current.value, next: next.value });
  accountBad.value = !r.ok;
  accountNote.value = r.ok ? 'Password changed. Anywhere else you were signed in has been signed out.' : r.error;
}
async function signOut() { emit('close'); await props.store.logout(); }

interface UserRow { id: string; email: string; name: string; role: string; disabled: boolean; has_password: boolean; last_seen: string | null }
const users = ref<UserRow[]>([]);
const usersNote = ref('');
const nu = reactive({ name: '', email: '', role: 'editor', password: '' });
async function loadUsers() {
  if (me.value?.role !== 'admin') return;
  const r = await props.store.call<UserRow[]>('GET', '/api/users');
  if (r.ok) users.value = r.data;
}
async function patchUser(id: string, patch: Record<string, unknown>) {
  const r = await props.store.call('PATCH', `/api/users/${id}`, patch);
  usersNote.value = r.ok ? '' : r.error;
  await loadUsers();                 // also puts a refused role <select> back
}
async function resetPassword(id: string, who: string) {
  const p = await askFull({ title: `A new password for ${who}`, label: 'At least 10 characters. They are signed out everywhere.', password: true, okText: 'Set password' });
  if (p?.value) await patchUser(id, { password: p.value });
}
async function addUser() {
  const r = await props.store.call('POST', '/api/users', { ...nu });
  usersNote.value = r.ok ? '' : r.error;
  if (r.ok) { Object.assign(nu, { name: '', email: '', role: 'editor', password: '' }); await loadUsers(); }
}
onMounted(loadUsers);

const LABEL: Record<string, string> = {
  'record.delete': 'Record deleted', 'table.delete': 'Table deleted', 'field.delete': 'Field deleted',
  'view.delete': 'View deleted', 'section.delete': 'Section deleted', 'link.remove': 'Link removed',
  'placement.remove': 'Card removed from a canvas', 'annotation.delete': 'Annotation deleted', 'canvas.delete': 'Canvas deleted',
};
const list = ref<Awaited<ReturnType<Store['undoable']>>>([]);
// Never rejects: this also runs from a timer, possibly just after signing out (a
// 401), and a rejected promise nobody awaits is an unhandled rejection.
const refresh = async () => { try { list.value = await props.store.undoable(50); } catch { /* signed out, or offline: keep what is shown */ } };

async function restore(id: string) {
  try { await props.store.undo(id); } catch { /* surfaced in store.errors */ }
  setTimeout(refresh, 500);
}
const describe = (c: Record<string, number>) =>
  Object.entries(c).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k.replace('canvas_annotations', 'annotations')}`).join(', ');
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

// Fetching once on open is not enough: a delete made a moment before opening this
// may not have reached the server yet (writes flush on a debounce). Every write
// comes back through the stream and advances lastSeq — that is the signal.
let timer: ReturnType<typeof setTimeout> | undefined;
watch(() => props.store.lastSeq.value, () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 150); });
onMounted(refresh);
onUnmounted(() => clearTimeout(timer));

function onKey(e: KeyboardEvent) { if (e.key === 'Escape') emit('close'); }
</script>

<style scoped>
.set-backdrop { position: fixed; inset: 0; z-index: 150; background: rgba(0, 0, 0, 0.45); display: flex; justify-content: center; align-items: flex-start; padding-top: 8vh; }
.settings { width: min(720px, 94vw); max-height: 84vh; overflow-y: auto; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 8px; padding: 16px 20px; box-shadow: var(--card-shadow-drag); font-size: 13px; }
header { display: flex; align-items: center; margin-bottom: 6px; }
h2 { margin: 0; font-size: 16px; flex: 1; }
h3 { margin: 16px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--text-muted); }
.x { background: none; border: none; color: var(--text-muted); font-size: 20px; cursor: pointer; }
.note { color: var(--text-muted); font-size: 12px; margin: 0 0 10px; line-height: 1.45; max-width: 60em; }
.hist { width: 100%; border-collapse: collapse; }
.hist td { padding: 5px 8px 5px 0; border-bottom: 1px solid var(--border-main); vertical-align: baseline; }
.what { white-space: nowrap; }
.when { white-space: nowrap; font-size: 11px; }
.do { text-align: right; width: 1%; white-space: nowrap; }
.muted { color: var(--text-muted); }
tr.done td { opacity: 0.5; }
.restore { background: none; border: 1px solid var(--border-main); color: var(--accent); border-radius: 4px; padding: 2px 10px; cursor: pointer; font: inherit; }
.restore:hover { border-color: var(--accent); }
.who { margin: 0 0 8px; }
.you { color: var(--accent); font-size: 11px; }
.line { display: flex; gap: 8px; }
.plain { background: none; border: 1px solid var(--border-main); color: var(--text-secondary); border-radius: 4px; padding: 2px 10px; cursor: pointer; font: inherit; }
.plain:hover { color: var(--text-primary); border-color: var(--accent); }
.plain.danger:hover { color: var(--danger); border-color: var(--danger); }
.warn { color: var(--warning); }
.role, .add-user input, .add-user select { background: var(--controls-bg); border: 1px solid var(--border-main); color: inherit; border-radius: 4px; padding: 3px 6px; font: inherit; min-width: 0; }
.add-user { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.add-user input { flex: 1 1 120px; }
.do .plain + .plain { margin-left: 4px; }
</style>
