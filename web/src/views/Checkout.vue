<template>
  <div>
    <h1 class="section-title" style="margin-top:8px">{{ t('checkout') }}</h1>

    <!-- 发起结算（/checkout） -->
    <template v-if="!done">
      <div v-if="!store.user" class="banner info">{{ t('guest_cannot_basket') }} · <a href="#/login" @click.prevent="goLogin('/checkout')">{{ t('login') }}</a></div>
      <div v-else-if="loading" class="muted">{{ i18n.isZh.value ? '正在创建 PayPal 订单…' : 'Creating PayPal order…' }}</div>

      <div v-else class="card-center" style="max-width:520px;padding:22px">
        <div v-if="items.length" class="checkout-items">
          <div v-for="it in items" :key="it.product_id" class="co-item">
            <img v-if="it.image" :src="mediaUrl(it.image)" :alt="it.name" decoding="async" />
            <span v-else class="ph">📖</span>
            <div class="co-info">
              <div class="co-name">{{ it.name }}</div>
              <div class="muted">× {{ it.quantity }}</div>
            </div>
            <div class="co-amt">${{ fmt(it.line_total_cents / 100) }}</div>
          </div>
        </div>
        <div class="summary" style="margin:14px 0 16px;background:transparent;padding:0">
          <div class="row"><span class="muted">{{ t('subtotal') }}</span><span>${{ fmt(subtotal / 100) }}</span></div>
          <div v-if="discount > 0" class="row"><span class="muted">{{ i18n.isZh.value ? '折扣' : 'Discount' }}</span><span style="color:var(--ok)">−${{ fmt(discount / 100) }}</span></div>
          <div class="row total"><span>{{ t('total') }}</span><span>${{ fmt(total / 100) }}</span></div>
        </div>
        <div class="banner info" style="display:flex;justify-content:space-between;align-items:center">
          <span>{{ i18n.isZh.value ? '结算方式' : 'Payment method' }}</span>
          <span style="font-weight:800;color:var(--accent)">PayPal</span>
        </div>
        <div v-if="err" class="banner err">{{ err }}</div>
        <button class="btn" style="width:100%" :disabled="starting" @click="begin">
          {{ starting ? (i18n.isZh.value ? '跳转中…' : 'Redirecting…') : t('checkout') }}
        </button>
        <div class="hint" style="display:flex;justify-content:space-between">
          <span>{{ t('free_demo') }}</span>
          <a href="#/basket" style="color:var(--accent)" @click.prevent="go('/basket')">{{ i18n.isZh.value ? '返回购物篮' : 'Back to basket' }}</a>
        </div>
      </div>
    </template>

    <!-- 完成对账（/checkout/done） -->
    <template v-else>
      <div class="card-center" style="max-width:520px">
        <div v-if="processing" class="muted">{{ t('checkout_processing') }}</div>
        <div v-else-if="result && result.status === 'paid'">
          <div class="banner ok">
            <div class="big" style="font-size:34px;text-align:center;margin-bottom:6px">✅</div>
            <div style="text-align:center;font-weight:700">{{ t('checkout_done_title') }}</div>
            <div style="text-align:center;margin-top:6px">${{ fmt(result.total) }} {{ t('currency') }} · #{{ result.order_no }}</div>
          </div>
          <div class="mt-16" style="display:flex;gap:10px;justify-content:center">
            <button class="btn ghost" @click="go('/orders')">{{ t('view_order') }}</button>
            <button class="btn" @click="go('/')">{{ i18n.isZh.value ? '继续购物' : 'Keep shopping' }}</button>
          </div>
        </div>
        <div v-else>
          <div class="banner err">
            <div style="text-align:center;font-weight:700;margin-bottom:4px">{{ t('pay_failed') }}</div>
            <div class="muted">{{ payErr || t('paypal_unavailable') }}</div>
          </div>
          <div class="mt-16" style="display:flex;gap:10px;justify-content:center">
            <button class="btn" @click="retry">{{ t('retry') }}</button>
            <button class="btn ghost" @click="go('/basket')">{{ t('basket_title') }}</button>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate, goLogin } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)

const total = ref(0)
const subtotal = ref(0)
const discount = ref(0)
const items = ref([])
const loading = ref(false)
const starting = ref(false)
const done = ref(false)
const processing = ref(false)
const result = ref(null)
const err = ref('')
const payErr = ref('')

function fmt(c) { return Number(c).toFixed(2) }
function go(to) { navigate(to) }

// 生成幂等 key（create 时存 localStorage，done 时取出来对账）
function newKey() {
  const k = 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  localStorage.setItem('oscar_pay_key', k)
  return k
}

async function loadBasket() {
  loading.value = true
  const r = await api.basket()
  if (r.status === 200) {
    total.value = r.data.total_cents
    subtotal.value = r.data.subtotal_cents || 0
    discount.value = r.data.discount_cents || 0
    items.value = r.data.items || []
  } else if (r.status === 401) {
    store.user = null
  }
  loading.value = false
}

function mediaUrl(name) { return 'static/media/' + name }

async function begin() {
  if (starting.value) return // 防重复提交：按钮 disabled 渲染前的同 tick 双击不再触发第二次
  if (total.value <= 0) { go('/basket'); return }
  starting.value = true
  err.value = ''
  const key = newKey()
  const origin = location.origin + location.pathname
  const return_url = origin + '#/checkout/done?key=' + key
  const cancel_url = origin + '#/basket'
  const r = await api.createOrder({
    key, return_url, cancel_url,
    email: store.user && store.user.email ? store.user.email : ''
  })
  if (r.status === 201) {
    // 直接跳 PayPal 沙箱
    window.location.href = r.data.approve_url
  } else {
    starting.value = false
    err.value = (r.data && r.data.message) || t('paypal_unavailable')
  }
}

async function complete() {
  processing.value = true
  result.value = null
  payErr.value = ''
  // 我们的 key 在 fragment（#/checkout/done?key=…）；PayPal 追加的 token 在 location.search（?token=…&cancel=…）
  const frag = location.hash.split('?')[1] || ''
  const q = new URLSearchParams(frag)
  const search = new URLSearchParams(location.search)
  const token = q.get('token') || search.get('token') || ''
  const key = q.get('key') || localStorage.getItem('oscar_pay_key') || ''
  const r = await api.completeByKey(key, token)
  if (r.status === 200) {
    result.value = r.data
    localStorage.removeItem('oscar_pay_key')
    store.refreshBasket()
  } else {
    payErr.value = (r.data && r.data.message) || t('paypal_unavailable')
  }
  processing.value = false
}

function retry() {
  complete()
}

onMounted(() => {
  const path = location.hash.replace(/^#/, '') || '/'
  if (path.startsWith('/checkout/done')) {
    done.value = true
    complete()
  } else {
    loadBasket()
  }
})
</script>

<style>
.checkout-items { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
.co-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; }
.co-item + .co-item { border-top: 1px solid var(--border); }
.co-item img, .co-item .ph { width: 40px; height: 52px; object-fit: cover; border-radius: 6px; background: #eef1f4; display: flex; align-items: center; justify-content: center; font-size: 20px; }
.co-info { flex: 1; min-width: 0; }
.co-name { font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.co-amt { font-weight: 700; font-size: 14px; white-space: nowrap; }
</style>
