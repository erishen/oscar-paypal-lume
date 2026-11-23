<template>
  <div>
    <h1 class="section-title" style="margin-top:8px">{{ page.title || t('page_not_found') }}</h1>
    <div v-if="msg" class="banner err">{{ msg }}</div>
    <div v-else class="card page-content" style="padding:18px" v-html="page.content"></div>
  </div>
</template>

<script setup>
import { ref, onMounted, watch } from 'vue'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useRoute } from '../lib/router'
import { setMeta, setProperty, setJSONLD } from '../lib/seo'

const i18n = useI18n()
const t = (k) => i18n.t(k)
const route = useRoute()
const page = ref({ title: '', content: '' })
const msg = ref('')

// HTML → 纯文本（meta/JSON-LD description 用；不执行脚本，仅取文本）
function textOf(html) {
  const d = document.createElement('div')
  d.innerHTML = html || ''
  return (d.textContent || '').replace(/\s+/g, ' ').trim()
}

async function load() {
  const slug = String(route.value.path).replace(/^\/page\//, '')
  const r = await api.page(slug)
  if (r.status === 200) {
    page.value = r.data; msg.value = ''
    if (r.data.title) document.title = r.data.title + ' · ' + t('store_name')
    // SEO：内容页结构化数据（WebPage）+ og 社交预览
    const plain = textOf(r.data.content).slice(0, 200)
    const pageUrl = location.origin + '/#/page/' + encodeURIComponent(slug)
    setJSONLD('page-ld', {
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: r.data.title,
      url: pageUrl,
      ...(plain ? { description: plain } : {})
    })
    setProperty('og:title', r.data.title || t('store_name'))
    setProperty('og:description', plain)
    setProperty('og:type', 'website')
    setProperty('og:url', pageUrl)
    setMeta('description', plain)
  } else {
    msg.value = t('page_not_found'); page.value = { title: '', content: '' }
    document.title = t('page_not_found') + ' · ' + t('store_name')
  }
}

onMounted(load)
watch(() => route.value.path, load)
</script>
