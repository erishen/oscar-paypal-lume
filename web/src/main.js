// 全局样式由 build.mjs 单独打包成 assets/style.css（index.html 引它），
// 不在 JS 里 import，避免 esbuild 内联
import { createApp } from 'vue'
import App from './App.vue'
import { store } from './lib/store'

createApp(App).mount('#app')
store.checkAuth()
