<template>
  <div>
    <h1 class="section-title" style="margin-top:8px">{{ t('admin_title') }}</h1>

    <div v-if="store.user == null" class="banner info">
      {{ t('admin_not_login') }} · <a href="#/login" @click.prevent="goLogin('/admin')">{{ t('login') }}</a>
    </div>
    <div v-else-if="store.user.role !== 'admin'" class="banner err">{{ t('admin_role_required') }}</div>

    <template v-else>
      <!-- 概览 -->
      <div v-if="tab === 'overview'">
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(170px,1fr))">
          <div v-for="c in cards" :key="c.label" class="card" style="padding:18px">
            <div class="cat">{{ c.label }}</div>
            <div class="price" style="font-size:26px;margin-top:6px">{{ c.value }}</div>
          </div>
        </div>
      </div>

      <!-- 订单管理 -->
      <div v-else-if="tab === 'orders'">
        <div class="toolbar">
          <span v-for="st in ['all', 'pending', 'paid', 'failed', 'canceled', 'refunded']" :key="st"
                class="chip" :class="{ active: filter === st }" @click="pickFilter(st)">
            {{ st === 'all' ? t('filter_all') : stLabel(st) }}
          </span>
          <button class="btn ghost small" style="margin-left:auto" @click="exportOrders">
            {{ i18n.isZh.value ? '导出 CSV' : 'Export CSV' }}
          </button>
          <span v-if="expMsg" class="muted" style="font-size:12px;margin-left:8px">{{ expMsg }}</span>
        </div>
        <div v-if="oLoading" class="muted">{{ i18n.isZh.value ? '加载中…' : 'Loading…' }}</div>
        <div v-else-if="orders.length === 0" class="empty">
          <div class="big">📦</div>{{ t('no_orders_admin') }}
        </div>
        <div v-else class="table">
          <div v-for="o in orders" :key="o.id" style="padding:14px;border-bottom:1px solid var(--border)">
            <div class="flex-between">
              <div>
                <span class="badge" :class="o.status">{{ stLabel(o.status) }}</span>
                <span class="muted" style="margin-left:10px">#{{ o.order_no }}</span>
                <span class="muted" style="margin-left:10px">{{ t('user') }}：{{ o.username }}</span>
              </div>
              <div class="price">${{ fmt(o.total) }} <small>{{ t('currency') }}</small></div>
            </div>
            <div class="muted" style="margin:8px 0">
              {{ t('order_date') }}: {{ fmtDate(o.created_at) }} · {{ o.item_count }} {{ i18n.isZh.value ? '件' : 'items' }}
              <template v-if="o.paypal_capture_id"> · capture {{ o.paypal_capture_id }}</template>
            </div>
            <div v-if="o.refunded_cents > 0" class="muted" style="margin:8px 0">
              {{ t('refunded') }} ${{ fmt(o.refunded_cents / 100) }} · {{ t('remaining') }} ${{ fmt(remaining(o)) }}
              <span v-if="o.refunds && o.refunds.length"> · {{ o.refunds.length }} {{ i18n.isZh.value ? '笔退款记录' : 'refund(s)' }}</span>
            </div>
            <div v-if="msg[o.id]" class="banner" :class="msg[o.id].kind" style="margin:8px 0">{{ msg[o.id].text }}</div>
            <div v-if="o.status === 'paid' && o.paypal_capture_id" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              <label class="muted" style="font-size:12px" :for="'refund-' + o.id">{{ t('refund_amount') }}</label>
              <input v-model.number="refundInput[o.id]" type="number" min="0.01" step="0.01" class="money-input" :id="'refund-' + o.id" />
              <button class="btn danger" :disabled="busy[o.id]" @click="refund(o)" :title="t('refund_hint')">
                {{ busy[o.id] ? '…' : t('refund') }}
              </button>
              <button class="btn ghost" :disabled="busy[o.id]" @click="refund(o, true)" :title="t('refund_hint')">
                {{ t('full_refund') }}
              </button>
            </div>
            <div v-else-if="o.status === 'pending'" class="muted">{{ i18n.isZh.value ? '待支付（未 capture，无需退款）' : 'Pending — not captured, nothing to refund' }}</div>
            <div v-else-if="o.status === 'refunded'" class="muted">{{ i18n.isZh.value ? '已全额退款，无需操作' : 'Fully refunded — no action needed' }}</div>
            <div v-else-if="o.status === 'failed'" class="muted">{{ i18n.isZh.value ? '支付失败，用户可重新下单' : 'Payment failed — user can re-order' }}</div>
          </div>
        </div>
      </div>

      <!-- 商品管理 -->
      <div v-else-if="tab === 'products'">
        <div class="toolbar" style="margin-bottom:8px">
          <button class="btn ghost small" style="margin-left:auto" @click="exportProducts">
            {{ i18n.isZh.value ? '导出 CSV' : 'Export CSV' }}
          </button>
          <span v-if="pExpMsg" class="muted" style="font-size:12px;margin-left:8px">{{ pExpMsg }}</span>
        </div>
        <div v-if="pLoading" class="muted">{{ i18n.isZh.value ? '加载中…' : 'Loading…' }}</div>
        <div v-else>
        <div v-if="pErr" class="banner err" style="margin-bottom:8px">{{ pErr }}</div>
        <div class="table">
          <table>
            <thead>
              <tr>
                <th style="width:60px"></th>
                <th>{{ i18n.isZh.value ? '名称' : 'Name' }}</th>
                <th>{{ t('price') }}</th>
                <th>{{ t('stock') }}</th>
                <th>{{ t('status') }}</th>
                <th style="width:170px"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in products" :key="p.id">
                <td><img v-if="p.image" :src="mediaUrl(p.image)" style="width:36px;height:48px;object-fit:cover;border-radius:4px;background:#eef1f4" :alt="p.name" decoding="async" /></td>
                <td>
                  <div style="font-weight:600">{{ p.name }}</div>
                  <div class="muted" style="font-size:12px">{{ p.sku }}</div>
                </td>
                <td>
                  <input v-model.number="priceInput[p.id]" class="money-input" type="number" min="0" step="0.01" :aria-label="i18n.isZh.value ? '价格' : 'Price'" />
                </td>
                <td>
                  <input v-model.number="stockInput[p.id]" class="money-input" style="width:64px" type="number" min="0" :aria-label="i18n.isZh.value ? '库存' : 'Stock'" />
                </td>
                <td>
                  <button class="toggle-btn" :class="p.displayable ? 'on' : 'off'" :disabled="pBusy[p.id]" @click="toggle(p)"
                          :title="p.displayable ? t('unpublish') : t('publish')">
                    <span class="dot"></span>{{ p.displayable ? t('visible') : t('hidden') }}
                  </button>
                </td>
                <td style="white-space:nowrap">
                  <button class="btn" style="padding:4px 10px;font-size:12px" :disabled="pBusy[p.id] || !dirty(p)" @click="saveProduct(p)">
                    {{ pBusy[p.id] ? '…' : t('save') }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        </div>
      </div>

      <!-- 用户管理 -->
      <div v-else-if="tab === 'users'" class="table">
        <table>
          <thead><tr><th>ID</th><th>{{ t('username') }}</th><th>{{ t('email') }}</th><th>{{ t('role') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="u in ext.users" :key="u.id">
              <td>{{ u.id }}</td><td>{{ u.username }}</td><td>{{ u.email || '—' }}</td>
              <td><span class="badge" :class="u.role === 'admin' ? 'paid' : ''">{{ u.role }}</span></td>
              <td>
                <button class="btn ghost small" @click="toggleUser(u)">{{ u.role === 'admin' ? t('reject') : t('approve') }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 优惠券管理 -->
      <div v-else-if="tab === 'vouchers'">
        <div class="toolbar">
          <input v-model="newVoucher.code" :placeholder="t('code')" :aria-label="t('code')" style="width:120px" />
          <input v-model.number="newVoucher.value" type="number" min="1" :placeholder="t('value')" :aria-label="t('value')" style="width:100px" />
          <select v-model="newVoucher.discount_type" :aria-label="t('discount_type')"><option value="percentage">%</option><option value="absolute">$</option></select>
          <button class="btn" :disabled="extBusy" @click="addVoucher">{{ t('add_address') }}</button>
        </div>
        <div v-if="extMsg" class="banner" :class="extOk ? 'ok' : 'err'" style="margin:8px 0">{{ extMsg }}</div>
        <div class="table"><table>
          <thead><tr><th>{{ t('code') }}</th><th>{{ t('discount') }}</th><th>{{ t('usage') }}</th><th>{{ t('status') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="v in ext.vouchers" :key="v.id">
              <td><strong>{{ v.code }}</strong><div class="muted" style="font-size:12px">{{ v.name }}</div></td>
              <td>{{ v.discount_type === 'percentage' ? v.value + '%' : '$' + fmt(v.value / 100) }}</td>
              <td>{{ v.num_orders }}{{ v.usage_limit > 0 ? '/' + v.usage_limit : '' }}</td>
              <td><span class="badge" :class="v.active ? 'paid' : 'canceled'">{{ v.active ? t('activate') : t('deactivate') }}</span></td>
              <td><button class="btn ghost small" @click="toggleVoucher(v)">{{ v.active ? t('deactivate') : t('activate') }}</button></td>
            </tr>
          </tbody>
        </table></div>
      </div>

      <!-- 评价管理 -->
      <div v-else-if="tab === 'reviews'" class="table"><table>
          <thead><tr><th>ID</th><th>{{ t('price') }}</th><th>{{ t('review_title') }}</th><th>{{ t('status') }}</th><th></th></tr></thead>
          <tbody>
            <tr v-for="r in ext.reviews" :key="r.id">
              <td>{{ r.id }}</td><td>{{ r.product_name }}</td>
              <td>{{ r.title }} <span class="muted">★{{ r.score }}</span></td>
              <td>{{ r.status }}</td>
              <td style="white-space:nowrap">
                <button class="btn ghost small" @click="patchReview(r, 1)">{{ t('approve') }}</button>
                <button class="btn ghost small" @click="patchReview(r, 2)">{{ t('reject') }}</button>
              </td>
            </tr>
          </tbody>
        </table></div>

      <!-- 内容页 -->
      <div v-else-if="tab === 'pages'">
        <div v-for="p in ext.pages" :key="p.id" class="card" style="padding:14px;margin:8px 0">
          <div class="field"><label :for="'pg-url-' + p.id">URL</label><input :id="'pg-url-' + p.id" :value="p.url" disabled /></div>
          <div class="field"><label :for="'pg-title-' + p.id">{{ t('review_title') }}</label><input :id="'pg-title-' + p.id" v-model="pageTitle[p.id]" /></div>
          <div class="field"><label :for="'pg-body-' + p.id">{{ t('review_body') }}</label><textarea :id="'pg-body-' + p.id" v-model="pageBody[p.id]" rows="4"></textarea></div>
          <button class="btn" @click="savePage(p)">{{ t('save') }}</button>
        </div>
      </div>

      <!-- 报表 -->
      <template v-else-if="tab === 'reports'">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">
          <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)">
            {{ t('report_since') }}
            <input type="date" v-model="reportSince" @change="loadReports()" aria-label="report since date"
              style="padding:5px 8px;border:1px solid var(--border);border-radius:6px;background:var(--surface);color:var(--ink)" />
          </label>
          <button v-if="reportSince" @click="reportSince = ''; loadReports()"
            style="padding:5px 10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--muted);cursor:pointer;font-size:12px">
            ✕ {{ t('report_since_all') }}
          </button>
          <span class="muted" style="font-size:12px">{{ reportSince ? t('report_since_active') : t('report_since_all') }}</span>
        </div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
        <div class="card" style="padding:16px"><div class="cat">{{ t('stat_paid_orders') }}</div><div class="price">{{ ext.report.paid_orders ?? '—' }}</div></div>
        <div class="card" style="padding:16px"><div class="cat">{{ t('gross') }}</div><div class="price">${{ fmt((ext.report.gross_cents || 0) / 100) }}</div></div>
        <div class="card" style="padding:16px"><div class="cat">{{ t('refunded') }}</div><div class="price">${{ fmt((ext.report.refunded_cents || 0) / 100) }}</div></div>
        <div class="card" style="padding:16px;grid-column:1/-1">
          <div class="cat">{{ t('top_products') }}</div>
          <div v-for="p in ext.report.top_products || []" :key="p.name" class="muted">{{ p.name }} — {{ p.qty }}</div>
        </div>
        <div class="card" style="padding:16px;grid-column:1/-1">
          <div class="cat">{{ t('sales_trend_7d') }}</div>
          <div class="trend" style="display:flex;gap:6px;align-items:flex-end;min-height:70px;margin-top:8px">
            <div v-for="d in ext.report.trend_7d || []" :key="d.date" style="flex:1;text-align:center">
              <div style="font-size:11px;color:var(--muted)">${{ (d.gross || 0).toFixed(2) }}</div>
              <div :style="{ height: Math.max(4, Math.min(40, (d.gross || 0) * 2)) + 'px', background: 'var(--accent)', opacity: 0.85, borderRadius: '3px 3px 0 0' }"></div>
              <div style="font-size:10px;color:var(--muted)">{{ d.date.slice(5) }}</div>
            </div>
          </div>
        </div>
        </div>
      </template>

      <!-- tab 切换 -->
      <div class="chips" style="margin-top:20px">
        <span v-for="tb in allTabs" :key="tb" class="chip" :class="{ active: tab === tb }" @click="pickTab(tb)">
          {{ tabLabel(tb) }}
        </span>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { navigate, goLogin, useRoute } from '../lib/router'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const route = useRoute()

const tab = ref('overview')
const filter = ref('all')
const reportSince = ref('')
const stats = ref({})
const orders = ref([])
const oLoading = ref(false)
const expMsg = ref('')
const products = ref([])
const pLoading = ref(false)
const pExpMsg = ref('')
const msg = reactive({})
const busy = reactive({})
const pBusy = reactive({})
const stockInput = reactive({})
const priceInput = reactive({})
const refundInput = reactive({})
const pErr = ref('')
const allTabs = ['overview', 'orders', 'products', 'users', 'vouchers', 'reviews', 'pages', 'reports']
const ext = reactive({ users: [], vouchers: [], reviews: [], pages: [], report: {} })
const extBusy = ref(false)
const extMsg = ref('')
const extOk = ref(false)
const newVoucher = reactive({ code: '', value: 10, discount_type: 'percentage' })
const pageTitle = reactive({})
const pageBody = reactive({})

function go(to) { navigate(to) }
function fmt(c) { return Number(c || 0).toFixed(2) }
function mediaUrl(img) { return '/static/media/' + encodeURIComponent(img) }
function fmtDate(ts) {
  if (!ts) return '—'
  try { return new Date(ts).toLocaleString(i18n.isZh.value ? 'zh-CN' : 'en-GB') } catch { return ts }
}
function remaining(o) {
  return Math.max(0, (Number(o.total_cents || 0) - Number(o.refunded_cents || 0)) / 100)
}
function stLabel(s) {
  const m = t('order_status')
  if (typeof m === 'object' && m[s]) return m[s]
  return s
}
function tabLabel(tb) {
  const map = {
    overview: 'admin_overview', orders: 'admin_orders', products: 'admin_products',
    users: 'admin_users', vouchers: 'admin_vouchers', reviews: 'admin_reviews',
    pages: 'admin_pages', reports: 'admin_reports'
  }
  return t(map[tb] || 'admin_overview')
}

const cards = computed(() => {
  const st = stats.value
  return [
    { label: t('stat_products'), value: st.products_visible ?? '—' },
    { label: t('stat_paid_orders'), value: st.orders_paid ?? '—' },
    { label: t('stat_gross'), value: st.gross != null ? '$' + Number(st.gross).toFixed(2) : '—' },
    { label: t('stat_refunded'), value: st.orders_refunded ?? '—' },
    { label: t('stat_last30'), value: st.orders_last_30d ?? '—' },
    { label: t('stat_visits_total'), value: st.visits_total ?? '—' },
    { label: t('stat_visits_24h'), value: st.visits_24h ?? '—' },
    { label: t('stat_visits_7d'), value: st.visits_7d ?? '—' }
  ]
})

function pickTab(tb) {
  tab.value = tb
  msgAll()
  if (tb === 'overview') loadStats()
  if (tb === 'orders') loadOrders()
  if (tb === 'products') loadProducts()
  if (tb === 'users') loadExt('users', api.adminUsers, 'users')
  if (tb === 'vouchers') loadExt('vouchers', api.adminVouchers, 'vouchers')
  if (tb === 'reviews') loadExt('reviews', api.adminReviews, 'reviews')
  if (tb === 'pages') loadExt('pages', api.adminPages, 'pages')
  if (tb === 'reports') loadReports()
}
async function loadReports() {
  const since = reportSince.value || undefined
  await loadExt('report', () => api.adminReports(since), 'report')
}
function extNotify(text, ok = true) { extMsg.value = text; extOk.value = ok }
async function loadExt(key, fn, field) {
  const r = await fn()
  if (r.status === 200) {
    ext[key] = r.data[field] || (field === 'report' ? r.data : [])
    if (key === 'pages') {
      for (const p of ext.pages) { pageTitle[p.id] = p.title; pageBody[p.id] = p.content }
    }
  }
}

async function toggleUser(u) {
  const r = await api.adminPatchUser(u.id, { role: u.role === 'admin' ? 'customer' : 'admin' })
  if (r.status === 200) u.role = r.data.role
  else extNotify((r.data && r.data.message) || t('save') + ' failed', false)
}
async function addVoucher() {
  extBusy.value = true
  const r = await api.adminAddVoucher(newVoucher)
  extBusy.value = false
  extNotify(r.status === 201 ? t('voucher_ok') : ((r.data && r.data.message) || t('voucher_fail')), r.status === 201)
  if (r.status === 201) { newVoucher.code = ''; await loadExt('vouchers', api.adminVouchers, 'vouchers') }
}
async function toggleVoucher(v) {
  const r = await api.adminPatchVoucher(v.id, { active: v.active ? 0 : 1 })
  if (r.status === 200) v.active = r.data.active
  else extNotify((r.data && r.data.message) || t('save') + ' failed', false)
}
async function patchReview(r0, status) {
  const r = await api.adminPatchReview(r0.id, { status })
  if (r.status === 200) r0.status = status
  else extNotify((r.data && r.data.message) || t('save') + ' failed', false)
}
async function savePage(p) {
  const r = await api.adminPatchPage(p.id, { title: pageTitle[p.id], content: pageBody[p.id] })
  extNotify(r.status === 200 ? t('save') + ' OK' : ((r.data && r.data.message) || t('save') + ' failed'), r.status === 200)
}
function pickFilter(f) {
  filter.value = f
  loadOrders()
}
// 订单 CSV 导出：GET /api/admin/orders/export（带当前 status 筛选）→ blob → 触发下载。
async function exportOrders() {
  expMsg.value = ''
  try {
    const qs = filter.value === 'all' ? '' : '?status=' + encodeURIComponent(filter.value)
    const res = await fetch('/api/admin/orders/export' + qs, { credentials: 'same-origin' })
    if (!res.ok) { expMsg.value = i18n.isZh.value ? '导出失败（' + res.status + '）' : 'Export failed (' + res.status + ')'; return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'orders.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    expMsg.value = i18n.isZh.value ? '导出失败' : 'Export failed'
  }
}
// 商品 CSV 导出：GET /api/admin/products/export → blob → 触发下载。
async function exportProducts() {
  pExpMsg.value = ''
  try {
    const res = await fetch('/api/admin/products/export', { credentials: 'same-origin' })
    if (!res.ok) { pExpMsg.value = i18n.isZh.value ? '导出失败（' + res.status + '）' : 'Export failed (' + res.status + ')'; return }
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'products.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } catch (e) {
    pExpMsg.value = i18n.isZh.value ? '导出失败' : 'Export failed'
  }
}
function msgAll() { for (const k in msg) delete msg[k] }

async function loadStats() {
  const r = await api.adminStats()
  if (r.status === 200) stats.value = r.data
}

async function loadOrders() {
  oLoading.value = true
  const params = filter.value === 'all' ? {} : { status: filter.value, limit: 100 }
  const r = await api.adminOrders(params)
  if (r.status === 200) {
    orders.value = r.data.orders || []
    for (const o of orders.value) refundInput[o.id] = remaining(o)
  }
  oLoading.value = false
}

async function loadProducts() {
  pLoading.value = true
  const r = await api.adminProducts()
  if (r.status === 200) {
    products.value = r.data.products || []
    pErr.value = ''
    for (const p of products.value) {
      stockInput[p.id] = p.stock
      priceInput[p.id] = p.price
    }
  }
  pLoading.value = false
}

async function refund(o, full = false) {
  if (!o.paypal_capture_id) { msg[o.id] = { kind: 'err', text: t('no_capture') }; return }
  const maxCents = Math.round(remaining(o) * 100)
  const amount = full ? maxCents : Math.round(Number(refundInput[o.id]) * 100)
  if (!Number.isFinite(amount) || amount <= 0 || amount > maxCents) {
    msg[o.id] = {
      kind: 'err',
      text: i18n.isZh.value
        ? `退款金额须在 0.01..${(maxCents / 100).toFixed(2)} 之间`
        : `Refund amount must be 0.01..${(maxCents / 100).toFixed(2)}`
    }
    return
  }
  busy[o.id] = true
  const r = await api.adminRefund(o.id, { amount_cents: amount })
  busy[o.id] = false
  if (r.status === 200) {
    const d = r.data || {}
    o.refunded_cents = d.refunded_cents ?? o.refunded_cents
    if (d.status) o.status = d.status
    if (Array.isArray(d.refunds)) o.refunds = d.refunds
    refundInput[o.id] = remaining(o)
    msg[o.id] = {
      kind: 'ok',
      text: d.already
        ? t('refund_already')
        : t('refund_ok') + ' $' + (amount / 100).toFixed(2) + ' · ' + stLabel(o.status)
    }
  } else {
    msg[o.id] = { kind: 'err', text: (r.data && r.data.message) || t('refund_fail') }
  }
  loadStats()
}

// 价格/库存是否有未保存改动（无改动时禁用保存按钮）
function dirty(p) {
  const stock = parseInt(stockInput[p.id], 10)
  const priceCents = Math.round(Number(priceInput[p.id]) * 100)
  if (Number.isNaN(stock) || stock !== p.stock) return true
  if (!Number.isFinite(priceCents) || priceCents !== p.price_cents) return true
  return false
}

async function toggle(p) {
  pBusy[p.id] = true
  const r = await api.adminPatchProduct(p.id, { displayable: p.displayable ? 0 : 1 })
  pBusy[p.id] = false
  if (r.status === 200) {
    p.displayable = r.data.displayable
    loadStats()
  }
}

async function saveProduct(p) {
  let stock = parseInt(stockInput[p.id], 10)
  if (Number.isNaN(stock) || stock < 0) { stock = 0 }
  const priceCents = Math.round(Number(priceInput[p.id]) * 100)
  if (!Number.isFinite(priceCents) || priceCents < 0) {
    pErr.value = i18n.isZh.value ? '价格须为不小于 0 的数字' : 'Price must be a non-negative number'
    return
  }
  pErr.value = ''
  pBusy[p.id] = true
  const r = await api.adminPatchProduct(p.id, { stock, price_cents: priceCents })
  pBusy[p.id] = false
  if (r.status === 200) {
    p.stock = r.data.stock
    p.price = r.data.price
    p.price_cents = r.data.price_cents
    stockInput[p.id] = r.data.stock
    priceInput[p.id] = r.data.price
  } else {
    pErr.value = (r.data && r.data.message) || t('save') + (i18n.isZh.value ? '失败' : ' failed')
  }
}

onMounted(() => {
  // 默认概览；URL 支持 ?tab=orders 之类
  const q = new URLSearchParams(location.hash.split('?')[1] || '')
  const tb = q.get('tab')
  if (tb && allTabs.includes(tb)) tab.value = tb
  if (store.user && store.user.role === 'admin') { pickTab(tab.value); userWired = true }
})

// 防御：若挂载时 store.user 尚未就绪（慢 /auth/me 或登录后返回），
// 用户变 admin 时重触发当前 tab 加载，避免概览/列表停留在空态。
let userWired = false
watch(() => store.user && store.user.role, (role) => {
  if (role === 'admin' && !userWired) { userWired = true; pickTab(tab.value) }
  if (role !== 'admin') { userWired = false }
})

// hash 只在 /admin?tab=... 之间变化时组件不会重挂载，监听路由切换 tab
watch(() => route.value.path + '?' + JSON.stringify(route.value.query), () => {
  if (route.value.path !== '/admin') return
  const tb = route.value.query && route.value.query.tab
  if (tb && allTabs.includes(tb) && tb !== tab.value && store.user && store.user.role === 'admin') pickTab(tb)
})
</script>

<style>
.table table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 14px; }
.table thead th { background: #fafafa; font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px; color: var(--muted); }
.table tbody tr:last-child td { border-bottom: 0; }
.money-input { width: 84px; padding: 4px 6px; border: 1px solid var(--border); border-radius: 6px; }
.toggle-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 600;
  border: 1px solid var(--border); background: var(--surface); cursor: pointer; color: var(--muted);
}
.toggle-btn .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.toggle-btn.on { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
.toggle-btn.off { background: #f3f4f6; color: #6b7280; }
.toggle-btn:hover { border-color: var(--accent); }
</style>
