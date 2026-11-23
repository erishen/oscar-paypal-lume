<template>
  <div>
    <h2 style="margin:0">{{ t('track_order') }}</h2>
    <p class="muted">{{ t('track_hint') }}</p>
    <form @submit.prevent="track" style="display:flex;gap:8px;flex-wrap:wrap">
      <input v-model="orderNo" :placeholder="t('order_no')" :aria-label="t('order_no')" required />
      <input v-model="email" type="email" :placeholder="t('email')" :aria-label="t('email')" required />
      <button class="btn" :disabled="busy">{{ busy ? '…' : t('track_btn') }}</button>
    </form>
    <div v-if="msg" class="banner err" style="margin:10px 0">{{ msg }}</div>
    <div v-if="result" class="card" style="padding:14px;margin-top:10px">
      <div class="flex-between">
        <div>
          <span class="badge" :class="result.status">{{ stLabel(result.status) }}</span>
          <span class="muted" style="margin-left:10px">#{{ result.order_no }}</span>
        </div>
        <div class="price">${{ fmt(result.total) }} {{ t('currency') }}</div>
      </div>
      <div class="muted" style="margin-top:8px">{{ t('order_date') }}: {{ fmtDate(result.created_at) }}</div>
      <div v-for="it in result.items" :key="it.product_id" class="muted" style="padding:2px 0">
        {{ it.name }} × {{ it.quantity }} — ${{ fmt(it.line_total_cents / 100) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const orderNo = ref('')
const email = ref('')
const busy = ref(false)
const result = ref(null)
const msg = ref('')
function fmt(c) { return Number(c).toFixed(2) }
function stLabel(s) { const m = t('order_status'); return m[s] || s }
function fmtDate(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString() } catch { return ts } }

async function track() {
  busy.value = true
  msg.value = ''
  result.value = null
  const r = await api.trackOrder(orderNo.value, email.value)
  busy.value = false
  if (r.status === 200) result.value = r.data
  else msg.value = (r.data && r.data.message) || t('not_found')
}
</script>
