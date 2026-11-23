// 极简 hash 路由（不引 vue-router：PayPal 跳回的 return_url 带 #，hash 最稳）
import { reactive, ref, computed, watch } from 'vue'

const routes = ref(location.hash.slice(1) || '/')
let queryCache = null

watch(routes, () => {
  window.scrollTo(0, 0)
})

export function navigate(to) {
  routes.value = to
  history.pushState(null, '', '#' + to)
}

// 跳登录并记录来源：登录成功后回到原页面（对齐 Oscar 的 ?next= 语义）。
// 只接受站内绝对路径，避免 hash 里塞外部 URL 造成跳转。
export function goLogin(next) {
  if (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')) {
    localStorage.setItem('oscar_next', next)
  }
  navigate('/login')
}

// 登录成功后读取并清掉来源，避免残留值污染下一次显式登录。
export function takeNext(fallback = '/basket') {
  const next = localStorage.getItem('oscar_next') || ''
  localStorage.removeItem('oscar_next')
  return next.startsWith('/') && !next.startsWith('//') ? next : fallback
}

export function currentRoute() {
  const raw = routes.value
  const qIdx = raw.indexOf('?')
  const path = qIdx >= 0 ? raw.slice(0, qIdx) : raw
  let query = {}
  if (qIdx >= 0) {
    for (const kv of raw.slice(qIdx + 1).split('&')) {
      if (!kv) continue
      const [k, v] = kv.split('=')
      query[decodeURIComponent(k)] = decodeURIComponent(v || '')
    }
  }
  return { path, query }
}

export function useRoute() {
  return computed(currentRoute)
}

// hash 变更（浏览器前进/后退、PayPal 直接跳回 URL）
window.addEventListener('hashchange', () => {
  routes.value = location.hash.slice(1) || '/'
})
