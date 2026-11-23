<template>
  <div class="card-center">
    <div class="auth-brand">
      <span class="mark">📚</span>
      <span class="name">{{ t('store_name') }}</span>
    </div>
    <h2>{{ t('register_title') }}</h2>
    <div v-if="err" class="banner err">{{ err }}</div>
    <form @submit.prevent="submit">
      <div class="field">
        <label for="reg-username">{{ t('username') }}</label>
        <input id="reg-username" v-model="username" autocomplete="username" required />
      </div>
      <div class="field">
        <label for="reg-email">{{ t('email') }}</label>
        <input id="reg-email" v-model="email" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="reg-password">{{ t('password') }}</label>
        <input id="reg-password" v-model="password" type="password" autocomplete="new-password" required />
      </div>
      <div class="field">
        <label for="reg-password2">{{ t('confirm_password') }}</label>
        <input id="reg-password2" v-model="password2" type="password" autocomplete="new-password" required />
      </div>
      <button class="btn" style="width:100%" :disabled="busy">{{ busy ? '…' : t('register_btn') }}</button>
    </form>
    <div class="hint">{{ t('have_account') }} <a href="#/login" @click.prevent="go('/login')">{{ t('login') }}</a></div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate, takeNext } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const username = ref('')
const email = ref('')
const password = ref('')
const password2 = ref('')
const busy = ref(false)
const err = ref('')
function go(to) { navigate(to) }

async function submit() {
  busy.value = true
  err.value = ''
  const r = await api.register({
    username: username.value, email: email.value,
    password: password.value, password2: password2.value
  })
  busy.value = false
  if (r.status === 201) {
    await store.checkAuth()
    await store.refreshBasket()
    navigate(takeNext('/'))
  } else {
    err.value = (r.data && r.data.message) || t('register') + ' failed'
  }
}
</script>
