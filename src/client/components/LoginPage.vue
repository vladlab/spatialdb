<!--
  The login screen — what the app is until the server says who you are.

  Deliberately plain: email, password, one button. No "create an account": users
  are made by an admin (Settings → Users) and the FIRST admin at a terminal
  (./scripts/user.sh) — an open sign-up or set-up page is a race that anyone who
  can reach the server could win.

  If edits were waiting when the session ended, they are still queued (store.ts
  keeps them on a 401) — the note under the form says so, because "sign in again"
  otherwise reads as "you lost your work".
-->
<template>
  <div class="login">
    <form class="box" @submit.prevent="submit">
      <h1>spatialdb</h1>

      <template v-if="store.auth.value === 'setup'">
        <p class="setup">Nobody can sign in yet. Create the first admin at a terminal on the server:</p>
        <pre class="cmd">./scripts/user.sh add you@example.com "Your Name" admin</pre>
        <button type="button" class="again" @click="store.whoAmI()">I've done that — check again</button>
      </template>

      <template v-else>
        <label>Email<input ref="emailInput" v-model="email" type="email" autocomplete="username" required /></label>
        <label>Password<input v-model="password" type="password" autocomplete="current-password" required /></label>
        <p v-if="error" class="error">{{ error }}</p>
        <button type="submit" class="go" :disabled="busy">{{ busy ? 'signing in…' : 'Sign in' }}</button>
        <p v-if="waiting" class="kept">{{ waiting }} unsaved change{{ waiting === 1 ? ' is' : 's are' }} waiting — signing in will save {{ waiting === 1 ? 'it' : 'them' }}.</p>
      </template>
    </form>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import type { Store } from '../store';

const props = defineProps<{ store: Store }>();

const email = ref('');
const password = ref('');
const error = ref('');
const busy = ref(false);
const emailInput = ref<HTMLInputElement>();
const waiting = computed(() => props.store.pending.value.length + props.store.inflight.value.length);

async function submit() {
  busy.value = true; error.value = '';
  const problem = await props.store.login(email.value, password.value);
  busy.value = false;
  password.value = '';
  // On success there is nothing to do here: the store's `auth` becomes 'in', App.vue
  // reacts to that, and this component is already gone.
  if (problem) error.value = problem;
}
onMounted(() => void nextTick(() => emailInput.value?.focus()));
</script>

<style scoped>
.login { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; background: var(--bg-app); }
.box { width: min(340px, 90vw); display: flex; flex-direction: column; gap: 12px; padding: 28px; border: 1px solid var(--border-main); border-radius: 10px; background: var(--controls-bg); box-shadow: var(--card-shadow-drag); }
h1 { margin: 0 0 6px; font-size: 20px; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); }
input { background: var(--bg-app); border: 1px solid var(--border-main); color: var(--text-primary); border-radius: 4px; padding: 8px 10px; font: inherit; font-size: 14px; }
input:focus { outline: none; border-color: var(--accent); }
.go, .again { margin-top: 4px; padding: 8px; border-radius: 4px; border: 1px solid var(--accent); background: none; color: var(--accent); font: inherit; cursor: pointer; }
.go:disabled { opacity: 0.6; cursor: default; }
.error { margin: 0; color: var(--danger); font-size: 12px; }
.kept { margin: 0; color: var(--warning); font-size: 12px; }
.setup { margin: 0; color: var(--text-secondary); font-size: 13px; line-height: 1.45; }
.cmd { margin: 0; padding: 8px 10px; background: var(--bg-app); border: 1px solid var(--border-main); border-radius: 4px; font-size: 11px; white-space: pre-wrap; word-break: break-all; }
</style>
