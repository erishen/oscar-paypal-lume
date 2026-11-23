<template>
  <div>
    <div class="hero-strip">
      <div>
        <h1>{{ i18n.isZh.value ? 'Lume 书店 · PayPal 演示店' : 'Lume Bookstore · PayPal Demo Shop' }}</h1>
        <p>{{ i18n.isZh.value ? '完整的购物篮 → 结算 → PayPal 沙箱支付 → 退款全链路演示。' : 'Full demo flow: basket → checkout → PayPal sandbox payment → refund.' }}</p>
      </div>
      <span class="hero-badge">PayPal ✔</span>
    </div>

    <div class="toolbar">
      <input v-model="q" class="search-box" :placeholder="t('search_ph')" :aria-label="t('search_ph')" @keyup.enter="doSearch" />
      <button class="btn" @click="doSearch">{{ i18n.isZh.value ? '搜索' : 'Search' }}</button>
    </div>

    <div class="chips">
      <span class="chip" :class="{ active: activeCat === '' }" @click="pickCat('')">
        {{ t('category_all') }}
      </span>
      <span v-for="c in cats" :key="c.name" class="chip" :class="{ active: activeCat === c.name }" @click="pickCat(c.name)">
        {{ c.name }}<span class="n">{{ c.count }}</span>
      </span>
    </div>

    <div v-if="searching || loading" class="muted">{{ i18n.isZh.value ? '加载中…' : 'Loading…' }}</div>

    <div v-else-if="products.length === 0" class="empty">
      <div class="big">{{ catUnknown ? '📭' : '🔍' }}</div>
      {{ catUnknown ? (i18n.isZh.value ? '该分类不存在或暂无商品' : 'Category not found or empty') : t('no_results') }}
    </div>

    <div v-else class="grid">
      <ProductCard v-for="(p, i) in products.slice(0, visible)" :key="p.id" :p="p" :eager="i < 8" />
    </div>

    <div v-if="!searching && !loading && visible < products.length" style="text-align:center;margin:18px 0">
      <button class="btn ghost" @click="visible += 24">
        {{ i18n.isZh.value ? '加载更多（' + (products.length - visible) + ' 剩余）' : 'Load more (' + (products.length - visible) + ' left)' }}
      </button>
    </div>

    <div v-if="searching" class="muted" style="margin-top:12px;">
      {{ products.length }} {{ t('items') }}
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import ProductCard from '../components/ProductCard.vue'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { setJSONLD, removeJSONLD } from '../lib/seo'

const i18n = useI18n()
const t = (k) => i18n.t(k)

const products = ref([])
const cats = ref([])
const activeCat = ref('')
const q = ref('')
const loading = ref(false)
const searching = ref(false)
const visible = ref(24)
const PAGE = 24

// 深链 ?cat=X 指向不存在的分类：给更明确的空态（区别于「无搜索结果」）
const catUnknown = computed(() => !!activeCat.value && !cats.value.some(c => c.name === activeCat.value))

// 分类激活时设 CollectionPage JSON-LD（`/?cat=X` 分类列表富结果）；全部/搜索时清掉。
function setCollectionLd() {
  const cat = activeCat.value
  if (cat) {
    setJSONLD('collection-ld', {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: cat + ' - ' + t('store_name'),
      url: location.origin + '/#/?cat=' + encodeURIComponent(cat),
      isPartOf: { '@type': 'WebSite', name: t('store_name'), url: location.origin + '/' }
    })
  } else {
    removeJSONLD('collection-ld')
  }
}

async function loadCatalog() {
  loading.value = true
  visible.value = PAGE
  const [c, p] = await Promise.all([
    api.categories(),
    api.products({ category: activeCat.value, limit: 500 })
  ])
  if (c.status === 200) cats.value = c.data.categories || []
  if (p.status === 200) products.value = p.data.results || []
  loading.value = false
  setCollectionLd()
}

function pickCat(name) {
  activeCat.value = name
  searching.value = false
  q.value = ''
  loadCatalog()
}

async function doSearch() {
  if (!q.value.trim()) { loadCatalog(); return }
  searching.value = true
  visible.value = PAGE
  // activeCat 非空时在分类内搜索（?q=&cat= 深链 / 分类内搜索框）
  const r = await api.search(q.value.trim(), activeCat.value || '')
  if (r.status === 200) products.value = r.data.results || []
  searching.value = false
  setCollectionLd()
}

onMounted(() => {
  // 先读 ?cat= 再一次性加载，避免带 cat 参数时 loadCatalog 被调两次（双重请求）
  const c = new URLSearchParams(location.hash.slice(location.hash.indexOf('?') + 1))
  if (c.get('cat')) activeCat.value = c.get('cat')
  // 支持 ?q= 深链搜索（分享/直达搜索 URL）：如 /#/?q=vue 直接出搜索结果
  const dq = c.get('q')
  if (dq && dq.trim()) {
    q.value = dq.trim()
    doSearch()
    return
  }
  loadCatalog()
})
</script>
