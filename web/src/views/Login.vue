<template>
  <div class="card-center">
    <div class="auth-brand">
      <span class="mark">📚</span>
      <span class="name">{{ t('store_name') }}</span>
    </div>
    <h2>{{ t('login_title') }}</h2>
    <p class="muted">{{ t('free_demo') }}</p>

    <div v-if="ok" class="banner ok">{{ i18n.isZh.value ? '登录成功' : 'Signed in' }}</div>
    <div v-if="err" class="banner err">{{ err }}</div>

    <form @submit.prevent="submit">
      <div class="field">
        <label for="login-username">{{ t('username') }}</label>
        <input id="login-username" v-model="username" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="login-password">{{ t('password') }}</label>
        <input id="login-password" v-model="password" type="password" autocomplete="current-password" required />
      </div>
      <button class="btn" style="width:100%" :disabled="busy">{{ busy ? '…' : t('login_btn') }}</button>
    </form>

    <div class="hint">
      {{ t('demo_hint') }}
      <div style="margin-top:6px">
        {{ t('no_account') }} <a href="#/register" @click.prevent="go('/register')">{{ t('register') }}</a>
        · <a href="#/reset" @click.prevent="go('/reset')">{{ t('reset_title') }}</a>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate, takeNext } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)
function go(to) { navigate(to) }

const username = ref('admin')
const password = ref('')
const busy = ref(false)
const err = ref('')
const ok = ref(false)

async function submit() {
  busy.value = true
  err.value = ''
  ok.value = false
  const success = await store.login(username.value, password.value)
  busy.value = false
  if (success) {
    ok.value = true
    setTimeout(() => {
      navigate(takeNext('/basket'))
    }, 400)
  } else {
    err.value = i18n.isZh.value ? '用户名或口令错误' : 'Invalid credentials'
  }
}
</script>
