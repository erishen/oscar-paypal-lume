<template>
  <div>
    <div class="flex-between">
      <h2 style="margin:0">{{ t('address_book') }}</h2>
      <button class="btn small" @click="editing = {}">{{ t('add_address') }}</button>
    </div>
    <div v-if="msg" class="banner" :class="msgKind" style="margin:10px 0">{{ msg }}</div>

    <div v-if="editing" class="card" style="padding:14px;margin:12px 0">
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr))">
        <div class="field"><label for="addr-first_name">{{ t('first_name') }}</label><input id="addr-first_name" v-model="editing.first_name" /></div>
        <div class="field"><label for="addr-last_name">{{ t('last_name') }}</label><input id="addr-last_name" v-model="editing.last_name" /></div>
        <div class="field"><label for="addr-line1">{{ t('line1') }}</label><input id="addr-line1" v-model="editing.line1" /></div>
        <div class="field"><label for="addr-city">{{ t('city') }}</label><input id="addr-city" v-model="editing.city" /></div>
        <div class="field"><label for="addr-postcode">{{ t('postcode') }}</label><input id="addr-postcode" v-model="editing.postcode" /></div>
        <div class="field"><label for="addr-country">{{ t('country') }}</label><input id="addr-country" v-model="editing.country" /></div>
        <div class="field"><label for="addr-phone">{{ t('phone') }}</label><input id="addr-phone" v-model="editing.phone" /></div>
        <div class="field"><label for="addr-notes">{{ t('notes') }}</label><input id="addr-notes" v-model="editing.notes" /></div>
      </div>
      <div class="muted" style="font-size:12px">
        <label class="field"><input v-model="editing.is_default_shipping" type="checkbox" /> {{ t('default_shipping') }}</label>
        <label class="field" style="margin-left:10px"><input v-model="editing.is_default_billing" type="checkbox" /> {{ t('default_billing') }}</label>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <button class="btn" :disabled="busy" @click="save">{{ t('save') }}</button>
        <button class="btn ghost" @click="editing = null">{{ i18n.isZh.value ? '取消' : 'Cancel' }}</button>
      </div>
    </div>

    <div v-if="items.length === 0" class="empty">{{ t('address_book') }} — {{ t('not_found') }}</div>
    <div v-for="a in items" :key="a.id" class="card" style="padding:14px;margin:10px 0">
      <div class="flex-between">
        <div>
          <strong>{{ a.first_name }} {{ a.last_name }}</strong>
          <div class="muted">{{ a.line1 }}, {{ a.city }} {{ a.postcode }}, {{ a.country }}</div>
          <div class="muted" v-if="a.phone">{{ t('phone') }}: {{ a.phone }}</div>
          <div style="margin-top:6px">
            <span v-if="a.is_default_shipping" class="badge paid">{{ t('default_shipping') }}</span>
            <span v-if="a.is_default_billing" class="badge paid" style="margin-left:6px">{{ t('default_billing') }}</span>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          <button class="btn ghost small" @click="setDefault(a, 'shipping')">{{ t('default_shipping') }}</button>
          <button class="btn ghost small" @click="setDefault(a, 'billing')">{{ t('default_billing') }}</button>
          <button class="btn ghost small" @click="editing = { ...a }">{{ i18n.isZh.value ? '编辑' : 'Edit' }}</button>
          <button class="btn danger small" @click="remove(a)">{{ t('delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const items = ref([])
const editing = ref(null)
const busy = ref(false)
const msg = ref('')
const msgKind = ref('ok')

function notify(text, kind = 'ok') { msg.value = text; msgKind.value = kind }
async function load() {
  const r = await api.addresses()
  if (r.status === 200) items.value = r.data.addresses || []
}

async function save() {
  const a = editing.value
  if (!a || !a.first_name || !a.last_name || !a.line1 || !a.city || !a.postcode) {
    notify(i18n.isZh.value ? '姓名/地址/城市/邮编必填' : 'Required fields missing', 'err')
    return
  }
  busy.value = true
  const body = {
    first_name: a.first_name, last_name: a.last_name, line1: a.line1, city: a.city,
    postcode: a.postcode, country: a.country || 'CN', phone: a.phone || '',
    notes: a.notes || '', is_default_shipping: a.is_default_shipping ? 1 : 0,
    is_default_billing: a.is_default_billing ? 1 : 0
  }
  const r = a.id ? await api.patchAddress(a.id, body) : await api.addAddress(body)
  busy.value = false
  notify(r.status < 300 ? t('save') + ' OK' : ((r.data && r.data.message) || t('save') + ' failed'), r.status < 300 ? 'ok' : 'err')
  if (r.status < 300) { editing.value = null; await load() }
}

async function setDefault(a, kind) {
  const r = await api.defaultAddress(a.id, kind)
  if (r.status === 200) await load()
  else notify((r.data && r.data.message) || t('set_default') + ' failed', 'err')
}

async function remove(a) {
  const r = await api.deleteAddress(a.id)
  if (r.status === 200) await load()
  else notify((r.data && r.data.message) || t('delete') + ' failed', 'err')
}

onMounted(load)
</script>
