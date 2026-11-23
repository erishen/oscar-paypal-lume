// API 客户端（同源；cookie 会话）
const BASE = ''

async function req(method, path, body, opts = {}) {
  const res = await fetch(BASE + path, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...opts
  })
  let data = null
  const text = await res.text()
  try { data = JSON.parse(text) } catch { data = text }
  return { status: res.status, data }
}

export const api = {
  // catalog
  products(params = {}) {
    const qs = new URLSearchParams(params).toString()
    return req('GET', '/api/products/' + (qs ? '?' + qs : ''))
  },
  product(slug) { return req('GET', '/api/products/' + encodeURIComponent(slug)) },
  search(q, category) {
    const p = new URLSearchParams({ q })
    if (category) p.set('category', category)
    return req('GET', '/api/products/search?' + p.toString())
  },
  categories() { return req('GET', '/api/categories/') },
  // auth
  login(username, password) { return req('POST', '/auth/login', { username, password }) },
  logout() { return req('POST', '/auth/logout', {}) },
  me() { return req('GET', '/auth/me') },
  register(payload) { return req('POST', '/auth/register', payload) },
  resetRequest(email) { return req('POST', '/auth/password-reset/request', { email }) },
  resetConfirm(token, password) { return req('POST', '/auth/password-reset/confirm', { token, password }) },
  // basket
  basket() { return req('GET', '/api/basket/') },
  addToBasket(product_id, quantity) { return req('POST', '/api/basket/', { product_id, quantity }) },
  removeFromBasket(product_id) { return req('DELETE', '/api/basket/' + product_id) },
  setBasketQty(product_id, quantity) { return req('PATCH', '/api/basket/' + product_id, { quantity }) },
  addVoucher(code) { return req('POST', '/api/basket/voucher', { code }) },
  removeVoucher() { return req('DELETE', '/api/basket/voucher') },
  // orders
  orders() { return req('GET', '/api/orders/') },
  order(id) { return req('GET', '/api/orders/' + id) },
  createOrder(payload) { return req('POST', '/api/orders/', payload) },
  completeByOrder(id, token) {
    const qs = token ? '?token=' + encodeURIComponent(token) : ''
    return req('GET', '/api/orders/' + id + '/complete' + qs)
  },
  completeByKey(key, token) {
    const p = new URLSearchParams()
    if (key) p.set('key', key)
    if (token) p.set('token', token)
    return req('GET', '/api/orders/complete?' + p.toString())
  },
  cancelOrder(id) { return req('POST', '/api/orders/' + id + '/cancel') },
  trackOrder(order_no, email) { return req('POST', '/api/orders/track', { order_no, email }) },
  // account / customer
  addresses() { return req('GET', '/api/addresses/') },
  addAddress(body) { return req('POST', '/api/addresses/', body) },
  patchAddress(id, body) { return req('PATCH', '/api/addresses/' + id, body) },
  deleteAddress(id) { return req('DELETE', '/api/addresses/' + id) },
  defaultAddress(id, kind) { return req('POST', '/api/addresses/' + id + '/default', { kind }) },
  wishlist() { return req('GET', '/api/wishlist/') },
  addWishlist(product_id, quantity = 1) { return req('POST', '/api/wishlist/', { product_id, quantity }) },
  removeWishlist(product_id) { return req('DELETE', '/api/wishlist/' + product_id) },
  moveWishlistToBasket(product_id) { return req('POST', '/api/wishlist/' + product_id + '/move-to-basket', {}) },
  reviews(slug) { return req('GET', '/api/products/' + encodeURIComponent(slug) + '/reviews') },
  addReview(slug, body) { return req('POST', '/api/products/' + encodeURIComponent(slug) + '/reviews', body) },
  pages() { return req('GET', '/api/pages/') },
  page(slug) { return req('GET', '/api/pages/' + encodeURIComponent(slug)) },
  // admin
  adminStats() { return req('GET', '/api/admin/stats') },
  adminOrders(params = {}) {
    const qs = new URLSearchParams(params).toString()
    return req('GET', '/api/admin/orders' + (qs ? '?' + qs : ''))
  },
  adminOrder(id) { return req('GET', '/api/admin/orders/' + id) },
  // body 可传 { amount_cents, key, note }；省略则退剩余全额
  adminRefund(id, body = {}) { return req('POST', '/api/admin/orders/' + id + '/refund', body) },
  adminProducts() { return req('GET', '/api/admin/products') },
  adminPatchProduct(id, body) { return req('PATCH', '/api/admin/products/' + id, body) },
  adminUsers() { return req('GET', '/api/admin/users') },
  adminPatchUser(id, body) { return req('PATCH', '/api/admin/users/' + id, body) },
  adminVouchers() { return req('GET', '/api/admin/vouchers') },
  adminAddVoucher(body) { return req('POST', '/api/admin/vouchers', body) },
  adminPatchVoucher(id, body) { return req('PATCH', '/api/admin/vouchers/' + id, body) },
  adminReviews() { return req('GET', '/api/admin/reviews') },
  adminPatchReview(id, body) { return req('PATCH', '/api/admin/reviews/' + id, body) },
  adminPages() { return req('GET', '/api/admin/pages') },
  adminPatchPage(id, body) { return req('PATCH', '/api/admin/pages/' + id, body) },
  adminReports(since) {
    const q = since ? '?since=' + encodeURIComponent(since) : ''
    return req('GET', '/api/admin/reports' + q)
  }
}
