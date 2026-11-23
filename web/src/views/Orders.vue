<template>
  <div>
    <h1 class="section-title" style="margin-top:8px">{{ t('orders_title') }}</h1>

    <div v-if="!store.user" class="banner info">{{ t('guest_cannot_basket') }} · <a href="#/login" @click.prevent="goLogin('/orders')">{{ t('login') }}</a></div>
    <div v-else-if="loading" class="muted">{{ i18n.isZh.value ? '加载中…' : 'Loading…' }}</div>
    <div v-else-if="orders.length === 0" class="empty">
      <div class="big">📦</div>
      {{ t('orders_empty') }}
      <div class="mt-16"><button class="btn" @click="go('/')">{{ t('continue_shopping') }}</button></div>
    </div>

    <div v-else class="table">
      <div v-for="o in orders" :key="o.id" class="order-row" @click="expand(o)">
        <div class="flex-between">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <span class="badge" :class="o.status">{{ statusLabel(o.status) }}</span>
            <span class="muted" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">#{{ o.order_no }}</span>
          </div>
          <div class="price">${{ fmt(o.total) }} <small>{{ t('currency') }}</small></div>
        </div>
        <div class="muted" style="margin-top:6px;display:flex;justify-content:space-between;align-items:center">
          <span>{{ fmtDate(o.created_at) }} · {{ o.item_count }} {{ i18n.isZh.value ? '件' : 'items' }}<span v-if="o.paypal_capture_id"> · ✓</span></span>
          <span class="expand-ind">{{ expanded[o.id] ? '▲' : '▼' }} {{ i18n.isZh.value ? '明细' : 'Details' }}</span>
        </div>
        <div v-if="expanded[o.id]" style="margin-top:10px;padding-top:10px;border-top:1px dashed var(--border)" @click.stop>
          <div v-for="it in o.items" :key="it.product_id" class="order-item">
            <span class="oi-name">{{ it.name }} <span class="muted">× {{ it.quantity }}</span></span>
            <span class="oi-amt">${{ fmt(it.line_total_cents / 100) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate, goLogin } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)

const orders = ref([])
const loading = ref(false)
const expanded = reactive({})

function go(to) { navigate(to) }
function fmt(c) { return Number(c).toFixed(2) }
function statusLabel(s) {
  const m = t('order_status')
  return m[s] || s
}
function fmtDate(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString(i18n.isZh.value ? 'zh-CN' : 'en-GB') } catch { return ts }
}
function expand(o) { expanded[o.id] = !expanded[o.id] }

onMounted(async () => {
  if (!store.user) return
  loading.value = true
  const r = await api.orders()
  if (r.status === 200) orders.value = r.data.orders || []
  loading.value = false
})
</script>

<style>
.order-row { padding: 14px 16px; border-bottom: 1px solid var(--border); cursor: pointer; transition: background 0.1s; }
.order-row:hover { background: #fafaf8; }
.order-row:last-child { border-bottom: 0; }
.expand-ind { font-size: 12px; color: var(--accent); white-space: nowrap; }
.order-item { display: flex; justify-content: space-between; gap: 12px; padding: 3px 0; font-size: 13px; color: #374151; }
.oi-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.oi-amt { font-weight: 600; white-space: nowrap; }
</style>
