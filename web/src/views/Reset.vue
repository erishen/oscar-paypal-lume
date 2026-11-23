<template>
  <div class="card-center">
    <div class="auth-brand">
      <span class="mark">📚</span>
      <span class="name">{{ t('store_name') }}</span>
    </div>
    <h2>{{ t('reset_title') }}</h2>
    <p class="muted">{{ t('reset_hint') }}</p>
    <div v-if="msg" class="banner" :class="ok ? 'ok' : 'err'">{{ msg }}</div>

    <template v-if="step === 'request'">
      <form @submit.prevent="requestReset">
        <div class="field">
          <label for="reset-email">{{ t('email') }}</label>
          <input id="reset-email" v-model="email" type="email" autocomplete="email" required />
        </div>
        <button class="btn" style="width:100%" :disabled="busy">{{ busy ? '…' : t('send_reset') }}</button>
      </form>
      <div v-if="demoToken" class="banner ok" style="word-break:break-all">
        {{ t('reset_token') }}: <code>{{ demoToken }}</code>
        <div class="mt-16"><button class="btn ghost" @click="step = 'confirm'">{{ t('reset_submit') }} →</button></div>
      </div>
    </template>

    <template v-else>
      <form @submit.prevent="confirmReset">
        <div class="field">
          <label for="reset-token">{{ t('reset_token') }}</label>
          <input id="reset-token" v-model="token" required />
        </div>
        <div class="field">
          <label for="reset-newpass">{{ t('reset_new_password') }}</label>
          <input id="reset-newpass" v-model="password" type="password" autocomplete="new-password" required />
        </div>
        <button class="btn" style="width:100%" :disabled="busy">{{ busy ? '…' : t('reset_submit') }}</button>
      </form>
    </template>

    <div class="hint"><a href="#/login" @click.prevent="go('/login')">{{ t('login') }}</a></div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { navigate } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const step = ref('request')
const email = ref('')
const token = ref('')
const password = ref('')
const busy = ref(false)
const msg = ref('')
const ok = ref(false)
const demoToken = ref('')
function go(to) { navigate(to) }

async function requestReset() {
  busy.value = true
  msg.value = ''
  const r = await api.resetRequest(email.value)
  busy.value = false
  ok.value = r.status === 200
  msg.value = (r.data && r.data.message) || t('reset_hint')
  demoToken.value = (r.data && r.data.demo_token) || ''
  if (demoToken.value) token.value = demoToken.value
}

async function confirmReset() {
  busy.value = true
  msg.value = ''
  const r = await api.resetConfirm(token.value, password.value)
  busy.value = false
  ok.value = r.status === 200
  msg.value = ok.value ? t('reset_ok') : ((r.data && r.data.message) || t('reset_submit') + ' failed')
  if (ok.value) setTimeout(() => navigate('/login'), 500)
}
</script>
