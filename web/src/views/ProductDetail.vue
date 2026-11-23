<template>
  <div v-if="p">
    <div class="crumbs">
      <a href="#/" @click.prevent="navigate('/')">{{ t('back_to_catalog') }}</a>
      <span class="sep">/</span>
      <span>{{ p.category }}</span>
    </div>

    <div class="detail">
      <div class="hero">
        <img v-if="p.image" :src="mediaUrl(p.image)" :alt="p.name" decoding="async" fetchpriority="high" />
        <div v-else class="ph" style="height:100%;display:flex;align-items:center;justify-content:center;font-size:60px;">📕</div>
      </div>
      <div>
        <h1>{{ p.name }}</h1>
        <div class="meta">SKU {{ p.sku }} · {{ p.category_path }}</div>
        <div class="price">${{ fmt(p.price) }} <small>USD</small></div>
        <div class="stock-note" :class="{ low: p.stock <= 3 && p.stock > 0 }">
          {{ p.stock === 0 ? t('out_of_stock') : (i18n.isZh.value ? '库存 ' + p.stock : t('in_stock') + ' ' + p.stock) }}
        </div>
        <p class="desc">{{ p.description }}</p>

        <div class="qty-row">
          <div class="qty">
            <button @click="qty = Math.max(1, qty - 1)" :aria-label="i18n.isZh.value ? '减少数量' : 'Decrease quantity'">−</button>
            <span>{{ qty }}</span>
            <button @click="qty = Math.min(p.stock || 99, qty + 1)" :aria-label="i18n.isZh.value ? '增加数量' : 'Increase quantity'">+</button>
          </div>
          <button class="btn" :disabled="p.stock === 0" @click="add">{{ t('add_to_basket') }}</button>
          <button v-if="store.user" class="btn ghost" @click="toggleWishlist">
            {{ inWishlist ? t('remove_from_wishlist') : t('add_to_wishlist') }}
          </button>
          <span v-if="wishMsg" class="muted" style="font-size:12px">{{ wishMsg }}</span>
        </div>

        <div v-if="added" class="banner ok">
          {{ i18n.isZh.value ? '已加入购物篮' : 'Added to basket' }}
          · <a href="#/basket" @click.prevent="go('/basket')">{{ t('basket_title') }}</a>
        </div>
      </div>
    </div>

    <div v-if="p.related && p.related.length" class="section-title">{{ t('related') }}</div>
    <div v-if="p.related && p.related.length" class="grid">
      <ProductCard v-for="r in p.related" :key="r.id" :p="r" />
    </div>

    <ReviewList v-if="p" :slug="p.slug" />
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import ProductCard from '../components/ProductCard.vue'
import ReviewList from '../components/ReviewList.vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate, goLogin, currentRoute } from '../lib/router'
import { setMeta, setProperty, setJSONLD } from '../lib/seo'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const p = ref(null)
const qty = ref(1)
const added = ref(false)
const inWishlist = ref(false)
const wishMsg = ref('')

const slug = () => {
  const path = location.hash.replace(/^#/, '') || '/'
  const m = path.match(/^\/product\/([^?\/]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

function mediaUrl(img) { return '/static/media/' + encodeURIComponent(img) }
function fmt(c) { return Number(c).toFixed(2) }
function go(to) { navigate(to) }

async function add() {
  const r = await api.addToBasket(p.value.id, qty.value)
  if (r.status === 200) {
    added.value = true
    await store.refreshBasket()
  } else if (r.status === 401) {
    goLogin(currentRoute().path) // 登录后可回到这件商品继续加购
  }
}

async function loadWishlist() {
  if (!store.user) { inWishlist.value = false; return }
  const r = await api.wishlist()
  if (r.status === 200) {
    inWishlist.value = (r.data.items || []).some(it => it.product_id === p.value.id)
  }
}

async function toggleWishlist() {
  const r = inWishlist.value
    ? await api.removeWishlist(p.value.id)
    : await api.addWishlist(p.value.id)
  if (r.status < 300) {
    inWishlist.value = !inWishlist.value
    wishMsg.value = ''
  } else {
    wishMsg.value = (r.data && r.data.message) || ''
  }
}

onMounted(async () => {
  const s = slug()
  if (!s) return
  const r = await api.product(s)
  if (r.status === 200) {
    p.value = r.data
    // 页面标题带上商品名（SEO/体验）：`书名 · Lume 书店`
    document.title = (r.data.name || '') + ' · ' + t('store_name')
    // SEO：Product 结构化数据（富结果：价格/库存/SKU）+ og 社交预览
    const imgAbs = r.data.image ? location.origin + mediaUrl(r.data.image) : ''
    const desc = (r.data.description || '').slice(0, 200)
    const pageUrl = location.origin + '/#/product/' + encodeURIComponent(s)
    setJSONLD('product-ld', {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: r.data.name,
      ...(imgAbs ? { image: imgAbs } : {}),
      description: desc,
      sku: r.data.sku,
      offers: {
        '@type': 'Offer',
        priceCurrency: 'USD',
        price: Number(r.data.price).toFixed(2),
        availability: r.data.stock > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: pageUrl
      },
      // 仅当存在已通过评价时输出（reviews 为空则省略，避免 0 星伪富结果）
      ...((Number(r.data.review_count) || 0) > 0 ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: Number(r.data.review_avg || 0).toFixed(1),
          bestRating: 5,
          worstRating: 1,
          ratingCount: Number(r.data.review_count)
        }
      } : {})
    })
    setProperty('og:title', r.data.name)
    setProperty('og:description', desc)
    if (imgAbs) setProperty('og:image', imgAbs)
    setProperty('og:type', 'product')
    setProperty('og:url', pageUrl)
    setMeta('description', desc)
    // SEO：面包屑（BreadcrumbList）——首页 → 分类 → 商品
    const crumbs = [
      { '@type': 'ListItem', position: 1, name: t('home') || '首页', item: location.origin + '/' }
    ]
    if (r.data.category) crumbs.push({ '@type': 'ListItem', position: 2, name: r.data.category, item: location.origin + '/#/?cat=' + encodeURIComponent(r.data.category) })
    crumbs.push({ '@type': 'ListItem', position: r.data.category ? 3 : 2, name: r.data.name, item: pageUrl })
    setJSONLD('breadcrumb-ld', { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs })
    await loadWishlist()
  }
})
</script>
