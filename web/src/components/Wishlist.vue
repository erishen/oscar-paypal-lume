<template>
  <div>
    <h2 style="margin:0">{{ t('wishlist_title') }}</h2>
    <div v-if="msg" class="banner" :class="msgKind" style="margin:10px 0">{{ msg }}</div>
    <div v-if="items.length === 0" class="empty">{{ t('wishlist_empty') }}</div>
    <div v-for="it in items" :key="it.product_id" class="line-item">
      <img v-if="it.image" :src="'/static/media/' + encodeURIComponent(it.image)" :alt="it.name" decoding="async" />
      <div>
        <div class="li-name"><a :href="'#/product/' + encodeURIComponent(it.slug)" @click.prevent="go('/product/' + it.slug)">{{ it.name }}</a></div>
        <div class="li-price">${{ fmt(it.price) }} · ×{{ it.quantity }}</div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn small" :disabled="it.stock === 0" @click="moveToBasket(it)">{{ t('move_to_basket') }}</button>
        <button class="btn ghost small" @click="remove(it)">{{ t('remove_from_wishlist') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const items = ref([])
const msg = ref('')
const msgKind = ref('ok')
function fmt(c) { return Number(c).toFixed(2) }
function go(to) { navigate(to) }
function notify(text, kind = 'ok') { msg.value = text; msgKind.value = kind }

async function load() {
  const r = await api.wishlist()
  if (r.status === 200) items.value = r.data.items || []
}

async function moveToBasket(it) {
  const r = await api.moveWishlistToBasket(it.product_id)
  if (r.status === 200) { await store.refreshBasket(); notify(t('move_to_basket') + ' OK'); await load() }
  else notify((r.data && r.data.message) || t('move_to_basket') + ' failed', 'err')
}

async function remove(it) {
  const r = await api.removeWishlist(it.product_id)
  if (r.status === 200) await load()
  else notify((r.data && r.data.message) || t('remove_from_wishlist') + ' failed', 'err')
}

onMounted(load)
</script>
