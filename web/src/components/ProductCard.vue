<template>
  <div class="card" @click.stop="onOpen">
    <div class="img-wrap">
      <img v-if="p.image" :src="mediaUrl(p.image)" :alt="p.name" :loading="eager ? 'eager' : 'lazy'" :fetchpriority="eager ? 'high' : 'auto'" decoding="async" />
      <span v-else class="ph">📕</span>
    </div>
    <div class="card-body">
      <div class="cat">{{ p.category }}</div>
      <div class="name">{{ p.name }}</div>
      <div class="price-row">
        <div class="price">${{ fmt(p.price) }} <small>USD</small></div>
        <div class="stock-note" :class="{ low: p.stock <= 3 && p.stock > 0 }">
          {{ p.stock === 0 ? t('out_of_stock') : (i18n.isZh.value ? '库存 ' + p.stock : t('in_stock') + ' ' + p.stock) }}
        </div>
      </div>
      <button class="btn" :class="{ added: justAdded }" :disabled="p.stock === 0" @click.stop="onAdd">
        {{ justAdded ? (i18n.isZh.value ? '✓ 已加入' : '✓ Added') : t('add_to_basket') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useI18n } from '../lib/i18n'
import { api } from '../lib/api'
import { store } from '../lib/store'

const i18n = useI18n()
const t = (k) => i18n.t(k)

const props = defineProps({ p: Object, eager: { type: Boolean, default: false } })
const justAdded = ref(false)
let addTimer = null

function mediaUrl(img) {
  if (!img) return ''
  // 商品图在 /static/media/<sku>.jpg（lume 的 STATIC_DIR）
  return '/static/media/' + encodeURIComponent(img)
}

function fmt(c) {
  return Number(c).toFixed(2)
}

async function onAdd() {
  const r = await api.addToBasket(props.p.id, 1)
  if (r.status === 200) {
    justAdded.value = true
    clearTimeout(addTimer)
    addTimer = setTimeout(() => { justAdded.value = false }, 1600)
    await store.refreshBasket()
  } else if (r.status === 401) {
    location.hash = '#/login'
  }
}

function onOpen() {
  location.hash = '#/product/' + props.p.slug
}

defineExpose({ mediaUrl })
</script>
