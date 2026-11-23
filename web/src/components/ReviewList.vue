<template>
  <div>
    <div class="flex-between">
      <h2 style="margin:0">{{ t('reviews_title') }}</h2>
      <button class="btn ghost small" @click="showForm = !showForm">{{ t('write_review') }}</button>
    </div>

    <div v-if="msg && !showForm" class="banner" :class="ok ? 'ok' : 'err'" style="margin:10px 0">{{ msg }}</div>

    <div v-if="showForm" class="card" style="padding:14px;margin:10px 0">
      <div class="field">
        <label for="rv-score">{{ t('your_score') }}</label>
        <select id="rv-score" v-model.number="form.score">
          <option v-for="n in 5" :key="n" :value="n">{{ n }} / 5</option>
        </select>
      </div>
      <div class="field"><label for="rv-title">{{ t('review_title') }}</label><input id="rv-title" v-model="form.title" /></div>
      <div v-if="!store.user" class="grid" style="grid-template-columns:1fr 1fr">
        <div class="field"><label for="rv-name">{{ t('first_name') }}</label><input id="rv-name" v-model="form.name" /></div>
        <div class="field"><label for="rv-email">{{ t('email') }}</label><input id="rv-email" v-model="form.email" type="email" /></div>
      </div>
      <div class="field"><label for="rv-body">{{ t('review_body') }}</label><textarea id="rv-body" v-model="form.body" rows="3"></textarea></div>
      <div v-if="msg" class="banner" :class="ok ? 'ok' : 'err'">{{ msg }}</div>
      <button class="btn" :disabled="busy" @click="submit">{{ t('submit_review') }}</button>
    </div>

    <div v-if="items.length === 0" class="muted">{{ t('reviews_empty') }}</div>
    <div v-for="r in items" :key="r.id" class="card" style="padding:12px;margin:8px 0">
      <div class="flex-between">
        <strong>{{ r.title }}</strong>
        <span class="muted">{{ '★'.repeat(r.score) }}</span>
      </div>
      <div class="muted" style="font-size:12px">{{ r.author }} · {{ fmtDate(r.created_at) }}</div>
      <div v-if="r.body" style="margin-top:6px">{{ r.body }}</div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../lib/api'
import { store } from '../lib/store'
import { useI18n } from '../lib/i18n'

const props = defineProps({ slug: { type: String, required: true } })
const i18n = useI18n()
const t = (k) => i18n.t(k)
const items = ref([])
const showForm = ref(false)
const busy = ref(false)
const msg = ref('')
const ok = ref(false)
const form = ref({ score: 5, title: '', body: '', name: '', email: '' })
function fmtDate(ts) { if (!ts) return '—'; try { return new Date(ts).toLocaleString() } catch { return ts } }

async function load() {
  const r = await api.reviews(props.slug)
  if (r.status === 200) items.value = r.data.reviews || []
}

async function submit() {
  busy.value = true
  msg.value = ''
  const r = await api.addReview(props.slug, form.value)
  busy.value = false
  ok.value = r.status === 201
  msg.value = ok.value ? t('review_ok') : ((r.data && r.data.message) || t('submit_review') + ' failed')
  if (ok.value) { showForm.value = false; form.value = { score: 5, title: '', body: '', name: '', email: '' }; await load() }
}

onMounted(load)
</script>
