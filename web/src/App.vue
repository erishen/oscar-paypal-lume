<template>
  <div>
    <a class="skip-link" href="#main" @click.prevent="skipToMain">{{ i18n.isZh.value ? '跳到主要内容' : 'Skip to main content' }}</a>
    <div class="demo-badge">{{ t('demo_badge') }}</div>
    <header class="site-header">
      <div class="container">
        <div class="brand">{{ t('store_name') }} <span>· PayPal</span></div>
        <nav class="nav">
          <a href="#/" :class="{ active: route.path === '/' || route.path === '' }" @click.prevent="go('/')">{{ t('home') }}</a>
          <a href="#/basket" class="basket-link" :class="{ active: route.path === '/basket' }" @click.prevent="go('/basket')">
            {{ t('basket') }}
            <span v-if="store.basketCount > 0" class="basket-count">{{ store.basketCount }}</span>
          </a>
          <a v-if="store.user" href="#/orders" :class="{ active: route.path === '/orders' }" @click.prevent="go('/orders')">{{ t('orders') }}</a>
          <a v-if="store.user" href="#/account" :class="{ active: route.path === '/account' }" @click.prevent="go('/account')">{{ t('account_title') }}</a>
          <a v-if="store.user && store.user.role === 'admin'" href="#/admin" :class="{ active: route.path === '/admin' }" @click.prevent="go('/admin')">{{ t('admin') }}</a>
          <a href="#/page/about" :class="{ active: route.path.startsWith('/page/about') }" @click.prevent="go('/page/about')">{{ i18n.isZh.value ? '关于' : 'About' }}</a>
          <a href="#/page/privacy" :class="{ active: route.path.startsWith('/page/privacy') }" @click.prevent="go('/page/privacy')">{{ i18n.isZh.value ? '隐私' : 'Privacy' }}</a>
        </nav>
        <div class="actions">
          <template v-if="store.user">
            <span class="user-chip">{{ store.user.username }}</span>
            <button class="btn ghost small" @click="doLogout">{{ t('logout') }}</button>
          </template>
          <a v-else class="btn small" href="#/login" @click.prevent="go('/login')">{{ t('login') }}</a>
          <button class="lang-toggle" @click="i18n.switch()">
            {{ i18n.isZh.value ? 'EN' : '中文' }}
          </button>
        </div>
      </div>
    </header>
    <main id="main" ref="mainEl" tabindex="-1">
      <div class="container">
        <!-- 等 /auth/me 回来再挂载页面，避免 Admin/Basket/Orders 首屏把未登录态当成最终态。
             :key=path 强制路由切换重挂（产品→产品/内容页→内容页共用组件时 onMounted 才会重跑，
             否则标题/meta/数据停留上一页）。path 不含 query，Admin?tab= 仍走 query watch 不重挂。 -->
        <component :is="view" :key="route.path" v-if="store.authChecked" />
      </div>
    </main>
    <footer class="site-footer">
      <div class="container">
        <div class="foot-links">
          <a href="#/" @click.prevent="go('/')">{{ t('home') }}</a>
          <a href="#/page/about" @click.prevent="go('/page/about')">{{ i18n.isZh.value ? '关于' : 'About' }}</a>
          <a href="#/page/privacy" @click.prevent="go('/page/privacy')">{{ i18n.isZh.value ? '隐私' : 'Privacy' }}</a>
          <a href="#/page/terms" @click.prevent="go('/page/terms')">{{ i18n.isZh.value ? '条款' : 'Terms' }}</a>
          <a href="https://www.paypal.com/" target="_blank" rel="noopener">PayPal Sandbox</a>
        </div>
        <div>{{ t('free_demo') }}</div>
      </div>
    </footer>
    <ChatWidget />
  </div>
</template>

<script setup>
import { computed, watch, ref, nextTick } from 'vue'
import { useRoute, navigate } from './lib/router'
import { useI18n } from './lib/i18n'
import { store } from './lib/store'
import { api } from './lib/api'
import { resetSeo, setJSONLD } from './lib/seo'

import Home from './views/Home.vue'
import ProductDetail from './views/ProductDetail.vue'
import Basket from './views/Basket.vue'
import Checkout from './views/Checkout.vue'
import Orders from './views/Orders.vue'
import Login from './views/Login.vue'
import Admin from './views/Admin.vue'
import Register from './views/Register.vue'
import Reset from './views/Reset.vue'
import Account from './views/Account.vue'
import Page from './views/Page.vue'
import ChatWidget from './components/ChatWidget.vue'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const route = useRoute()

// 站点级 WebSite 结构化数据（运行时 origin，与静态 BookStore 互补）。
// hash 路由不做 SearchAction（Google 对 fragment 的 searchbox 支持有限），
// 仅补 WebSite 身份 + 绝对 url。
setJSONLD('site-ld', {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: t('store_name'),
  url: location.origin + '/'
})

const view = computed(() => {
  const { path } = route.value
  if (path === '/' || path === '') return Home
  if (path.startsWith('/product/')) return ProductDetail
  if (path === '/basket') return Basket
  if (path === '/checkout' || path.startsWith('/checkout/')) return Checkout
  if (path === '/orders') return Orders
  if (path === '/login') return Login
  if (path === '/register') return Register
  if (path === '/reset') return Reset
  if (path === '/account') return Account
  if (path === '/admin') return Admin
  if (path.startsWith('/page/')) return Page
  return Home
})

// 动态页面标题（SPA 每路由）：`页名 · Lume 书店`；首页保持 `Lume 书店 · DEMO`。
// 商品详情/内容页由各自视图加载后覆盖（含商品/页面名）。
function setTitle(path) {
  const p = (path || '/').split('?')[0]
  const map = {
    '/': 'store_name', '/basket': 'basket_title', '/orders': 'orders_title',
    '/login': 'login_title', '/register': 'register_title', '/reset': 'reset_title',
    '/account': 'account_title', '/admin': 'admin_title'
  }
  if (p === '/' || p === '') { document.title = t('store_name') + ' · DEMO'; return }
  if (p.startsWith('/checkout')) { document.title = t('checkout_title') + ' · ' + t('store_name'); return }
  const key = map[p]
  if (key) { document.title = t(key) + ' · ' + t('store_name') }
  // /product/*、/page/* 由视图异步设置标题
}
// 标题依赖路由 + 语言：切换语言时同路由标题也要更新
watch([() => route.value.path, () => i18n.lang.value], () => setTitle(route.value.path), { immediate: true })

// 路由切换即清路由级 SEO（product-ld/page-ld/breadcrumb-ld/collection-ld + og 还原默认）。
// 各视图挂载后（:key 重挂）重新写入自己的；避免任何路由间的 JSON-LD/og 残留。
watch(() => route.value.path, () => resetSeo())

// 路由切换后把焦点移到主内容（读屏/键盘用户不迷失）。首挂载不抢焦点；聊天中不抢（不打断输入）。
const mainEl = ref(null)
let didRouteMount = false
watch(() => route.value.path, () => {
  if (!didRouteMount) { didRouteMount = true; return }
  nextTick(() => {
    const ae = document.activeElement
    if (ae && ae.closest && ae.closest('.chat-panel')) return
    if (mainEl.value) mainEl.value.focus()
  })
}, { immediate: true })

function skipToMain() {
  if (mainEl.value) mainEl.value.focus()
}

function go(to) { navigate(to) }

async function doLogout() {
  await store.logout()
  navigate('/')
}
</script>
