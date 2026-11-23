// 全局状态：登录会话 + 购物篮计数（reactive，跨组件共享）
import { reactive } from 'vue'
import { api } from './api'

export const store = reactive({
  user: null,
  authChecked: false,
  basketCount: 0,

  async checkAuth() {
    const r = await api.me()
    if (r.status === 200 && r.data && r.data.authenticated !== false && r.data.username) {
      store.user = r.data
    } else {
      store.user = null
    }
    store.authChecked = true
  },

  async login(username, password) {
    const r = await api.login(username, password)
    if (r.status === 200) {
      store.user = r.data
      // /auth/me 带 email（注册/找回依赖它），顺手刷新购物篮角标
      await store.checkAuth()
      await store.refreshBasket()
      return true
    }
    return false
  },

  async logout() {
    await api.logout()
    store.user = null
    store.basketCount = 0
  },

  async refreshBasket() {
    if (!store.user) return
    const r = await api.basket()
    if (r.status === 200) {
      store.basketCount = r.data.item_count || 0
    }
  }
})
