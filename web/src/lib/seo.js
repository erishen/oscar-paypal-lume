// 动态 <head> 管理（SPA hash 路由）：页内 <head> 的 meta/JSON-LD 仍可被部分
// 爬虫与社交分享器读取。提供 meta / OpenGraph / JSON-LD 增删改小工具。
// 注意：hash 路由对搜索引擎 fragment 索引有限，但结构化数据（Product）与
// og:* 对富结果与分享预览仍有价值；未来改 history 路由可直接复用。

// 首次加载时（bundle 求值、任何路由渲染前）抓取 index.html 的默认 og 值，
// 用于离开商品详情时还原，避免产品级 meta 残留到其他路由。
const def = (attr, key) =>
  (document.head.querySelector(`meta[${attr}="${key}"]`) || {}).getAttribute
    ? document.head.querySelector(`meta[${attr}="${key}"]`).getAttribute('content') || ''
    : ''
const DEFAULT_OG = { 'og:title': def('property', 'og:title'), 'og:description': def('property', 'og:description') }
const DEFAULT_DESC = def('name', 'description')

function upsertMeta(attr, key, content) {
  let el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', content || '')
  return el
}

function removeMeta(attr, key) {
  const el = document.head.querySelector(`meta[${attr}="${key}"]`)
  if (el) el.remove()
}

export function setMeta(name, content) { return upsertMeta('name', name, content) }
export function setProperty(prop, content) { return upsertMeta('property', prop, content) }

export function setJSONLD(id, data) {
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('script')
    el.type = 'application/ld+json'
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = JSON.stringify(data)
  return el
}

export function removeJSONLD(id) {
  const el = document.getElementById(id)
  if (el) el.remove()
}

// 离开商品/内容页：清产品级 og:image/og:type/og:url + Product/Page JSON-LD，
// 并把 og:title/og:description/description 还原为站点默认。
export function resetSeo() {
  removeJSONLD('product-ld')
  removeJSONLD('page-ld')
  removeJSONLD('breadcrumb-ld')
  removeJSONLD('collection-ld')
  removeMeta('property', 'og:image')
  removeMeta('property', 'og:type')
  removeMeta('property', 'og:url')
  upsertMeta('property', 'og:title', DEFAULT_OG['og:title'])
  upsertMeta('property', 'og:description', DEFAULT_OG['og:description'])
  upsertMeta('name', 'description', DEFAULT_DESC)
}
