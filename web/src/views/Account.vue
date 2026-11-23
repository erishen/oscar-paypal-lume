<template>
  <div>
    <h1 class="section-title" style="margin-top:8px">{{ t('account_title') }}</h1>
    <div v-if="!store.user" class="banner info">{{ t('guest_cannot_basket') }} · <a href="#/login" @click.prevent="goLogin('/account')">{{ t('login') }}</a></div>
    <template v-else>
      <div class="account-layout">
        <div class="account-tabs">
          <span v-for="tb in tabs" :key="tb.key" class="chip" :class="{ active: tab === tb.key }" @click="tab = tb.key">
            {{ t(tb.label) }}
          </span>
        </div>
        <div class="account-body">
          <div v-if="tab === 'profile'" class="card" style="padding:20px">
            <div class="profile-head">
              <div class="avatar">{{ (store.user.username || '?')[0].toUpperCase() }}</div>
              <div>
                <div style="font-weight:700;font-size:17px">{{ store.user.username }}</div>
                <div class="muted">{{ store.user.email || '—' }}</div>
              </div>
              <span class="badge" :class="store.user.role === 'admin' ? 'paid' : 'canceled'" style="margin-left:auto">
                {{ store.user.role === 'admin' ? (i18n.isZh.value ? '管理员' : 'Admin') : (i18n.isZh.value ? '顾客' : 'Customer') }}
              </span>
            </div>
            <div class="quick-links">
              <a href="#/orders" class="quick-card" @click.prevent="go('/orders')">
                <div class="qc-big">📦</div>
                <div class="qc-label">{{ t('orders') }}</div>
                <div class="muted" v-if="orderCount >= 0">{{ orderCount }} {{ i18n.isZh.value ? '笔' : 'orders' }}</div>
              </a>
              <a href="#/basket" class="quick-card" @click.prevent="go('/basket')">
                <div class="qc-big">🛒</div>
                <div class="qc-label">{{ i18n.isZh.value ? '购物篮' : 'Basket' }}</div>
                <div class="muted">{{ store.basketCount || 0 }} {{ i18n.isZh.value ? '件' : 'items' }}</div>
              </a>
            </div>
          </div>
          <AddressBook v-else-if="tab === 'addresses'" />
          <Wishlist v-else-if="tab === 'wishlist'" />
          <TrackOrder v-else />
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { store } from '../lib/store'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { goLogin, navigate } from '../lib/router'
import AddressBook from '../components/AddressBook.vue'
import Wishlist from '../components/Wishlist.vue'
import TrackOrder from '../components/TrackOrder.vue'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const tab = ref('profile')
const orderCount = ref(-1)
const tabs = [
  { key: 'profile', label: 'profile' },
  { key: 'addresses', label: 'address_book' },
  { key: 'wishlist', label: 'wishlist_title' },
  { key: 'track', label: 'track_order' }
]
function go(to) { navigate(to) }

onMounted(async () => {
  if (!store.user) return
  const r = await api.orders()
  if (r.status === 200) orderCount.value = (r.data.orders || []).length
})
</script>

<style>
.account-layout { display: flex; gap: 20px; align-items: flex-start; }
.account-tabs { display: flex; flex-direction: column; gap: 6px; min-width: 140px; }
.account-body { flex: 1; min-width: 0; }
.profile-head { display: flex; align-items: center; gap: 14px; }
.avatar {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; font-weight: 800; flex-shrink: 0;
}
.quick-links { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin-top: 18px; }
.quick-card {
  border: 1px solid var(--border); border-radius: var(--radius);
  padding: 14px; display: flex; flex-direction: column; gap: 4px;
  transition: border-color 0.1s, transform 0.08s;
}
.quick-card:hover { border-color: var(--accent); transform: translateY(-1px); }
.qc-big { font-size: 22px; }
.qc-label { font-weight: 600; font-size: 14px; }
@media (max-width: 700px) { .account-layout { flex-direction: column; } .account-tabs { flex-direction: row; flex-wrap: wrap; } }
</style>
