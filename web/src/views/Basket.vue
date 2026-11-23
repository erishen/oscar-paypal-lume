<template>
  <div>
    <h1 class="section-title" style="margin-top:8px">{{ t('basket_title') }}</h1>

    <div v-if="!store.user" class="banner info">{{ t('guest_cannot_basket') }} · <a href="#/login" @click.prevent="goLogin('/basket')">{{ t('login') }}</a></div>

    <div v-else-if="loading" class="muted">{{ i18n.isZh.value ? '加载中…' : 'Loading…' }}</div>

    <div v-else-if="items.length === 0" class="empty">
      <div class="big">🛒</div>
      {{ t('basket_empty') }}
      <div class="mt-16"><button class="btn" @click="go('/')">{{ t('continue_shopping') }}</button></div>
    </div>

    <template v-else>
      <div class="table">
        <div v-for="it in items" :key="it.product_id" class="line-item">
          <img v-if="it.image" :src="mediaUrl(it.image)" :alt="it.name" decoding="async" />
          <div>
            <div class="li-name">{{ it.name }}</div>
            <div class="li-price">${{ fmt(it.price) }}</div>
          </div>
          <div class="qty">
            <button @click="dec(it)" :aria-label="i18n.isZh.value ? '减少数量' : 'Decrease quantity'">&minus;</button>
            <span>{{ it.quantity }}</span>
            <button @click="inc(it)" :aria-label="i18n.isZh.value ? '增加数量' : 'Increase quantity'">+</button>
          </div>
          <div style="display:flex; align-items:center; gap:16px;">
            <div class="price">${{ fmt(it.line_total_cents / 100) }}</div>
            <button class="btn ghost" @click="remove(it)">{{ t('remove') }}</button>
          </div>
        </div>
      </div>

      <div class="summary">
        <div class="row"><span class="muted">{{ t('item_count_label') }}</span><span>{{ item_count }}</span></div>
        <div class="row"><span class="muted">{{ t('subtotal') }}</span><span>${{ fmt(subtotal / 100) }}</span></div>
        <div v-if="voucher" class="row">
          <span class="muted">{{ t('voucher') }}: {{ voucher.code }}</span>
          <span>-${{ fmt(discount / 100) }} <button class="btn ghost small" @click="removeVoucher">{{ t('remove_voucher') }}</button></span>
        </div>
        <div class="row" style="gap:8px">
          <input v-model="voucherCode" :placeholder="t('voucher_placeholder')" :aria-label="t('voucher_placeholder')" style="flex:1" />
          <button class="btn ghost" :disabled="voucherBusy" @click="applyVoucher">{{ voucherBusy ? '…' : t('apply_voucher') }}</button>
        </div>
        <div v-if="voucherMsg" class="banner" :class="voucherOk ? 'ok' : 'err'" style="margin:6px 0">{{ voucherMsg }}</div>
        <div class="row total"><span>{{ t('total') }}</span><span>${{ fmt(total / 100) }} {{ t('currency') }}</span></div>
        <div class="mt-16">
          <button class="btn" style="width:100%" @click="checkout">{{ t('checkout') }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate, goLogin } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)

const items = ref([])
const total = ref(0)
const item_count = ref(0)
const subtotal = ref(0)
const discount = ref(0)
const voucher = ref(null)
const voucherCode = ref('')
const voucherBusy = ref(false)
const voucherMsg = ref('')
const voucherOk = ref(false)
const loading = ref(false)

function mediaUrl(img) { return '/static/media/' + encodeURIComponent(img) }
function fmt(c) { return Number(c).toFixed(2) }
function go(to) { navigate(to) }

async function load() {
  loading.value = true
  const r = await api.basket()
  if (r.status === 200) {
    items.value = r.data.items || []
    total.value = r.data.total_cents
    subtotal.value = r.data.subtotal_cents || r.data.total_cents
    discount.value = r.data.discount_cents || 0
    voucher.value = r.data.voucher || null
    item_count.value = r.data.item_count
  } else if (r.status === 401) {
    store.user = null
  }
  loading.value = false
}

async function inc(it) {
  const r = await api.setBasketQty(it.product_id, it.quantity + 1)
  if (r.status === 200) {
    await load()
    await store.refreshBasket()
  }
}
async function dec(it) {
  const r = await api.setBasketQty(it.product_id, it.quantity - 1)
  if (r.status === 200) {
    await load()
    await store.refreshBasket()
  }
}
async function remove(it) {
  const r = await api.removeFromBasket(it.product_id)
  if (r.status === 200) {
    await load()
    await store.refreshBasket()
  }
}

async function applyVoucher() {
  voucherBusy.value = true
  voucherMsg.value = ''
  const r = await api.addVoucher(voucherCode.value)
  voucherBusy.value = false
  voucherOk.value = r.status === 200
  voucherMsg.value = voucherOk.value ? t('voucher_ok') : ((r.data && r.data.message) || t('voucher_fail'))
  await load()
}

async function removeVoucher() {
  const r = await api.removeVoucher()
  voucherMsg.value = r.status === 200 ? t('remove_voucher') : t('voucher_fail')
  voucherOk.value = r.status === 200
  voucherCode.value = ''
  await load()
}

async function checkout() {
  navigate('/checkout')
}

onMounted(() => { if (store.user) load() })
</script>
