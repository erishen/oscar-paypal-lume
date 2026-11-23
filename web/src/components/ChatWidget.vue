<template>
  <div class="chat-root">
    <!-- 浮动按钮 -->
    <button v-if="!open" class="chat-fab" @click="openChat" :aria-label="i18n.isZh.value ? 'Lume 助手' : 'Lume Assistant'">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
      </svg>
      <span v-if="unread" class="chat-badge">{{ unread }}</span>
    </button>

    <!-- 面板 -->
    <div v-if="open" class="chat-panel">
      <div class="chat-head">
        <div class="chat-title">
          <span class="chat-dot"></span>
          {{ i18n.isZh.value ? 'Lume 助手' : 'Lume Assistant' }}
        </div>
        <button class="chat-clear" @click="clearChat" :aria-label="i18n.isZh.value ? '清空会话' : 'Clear conversation'">🗑</button>
        <button class="chat-close" @click="close" aria-label="Close">×</button>
      </div>

      <div ref="scroller" class="chat-body" role="log" aria-live="polite" aria-relevant="additions" aria-label="聊天记录" :aria-busy="busy">
        <div v-if="messages.length === 0" class="chat-empty">
          {{ i18n.isZh.value
            ? '你好！我是商店助手，可以查商品、价格、库存、订单状态和经营统计。'
            : 'Hi! I\'m the store assistant — ask about products, prices, stock, order status or store stats.' }}
        </div>
        <!-- 空态快捷问题：点一下即问 -->
        <div v-if="messages.length === 0 && !busy" class="chat-chips">
          <button v-for="q in quickQuestions" :key="q" class="chip" @click="ask(q)">{{ q }}</button>
        </div>
        <div v-for="(m, i) in messages" :key="i" :class="['msg', m.kind]">
          <div class="msg-bubble" v-html="m.html"></div>
        </div>
        <div v-if="busy && lastKind !== 'delta'" class="msg assistant">
          <div class="msg-bubble typing">{{ i18n.isZh.value ? '思考中…' : 'Thinking…' }}</div>
        </div>
      </div>

      <form class="chat-input" @submit.prevent="send">
        <textarea
          ref="inputEl"
          v-model="text"
          rows="1"
          :placeholder="i18n.isZh.value ? '输入问题，Enter 发送' : 'Ask a question…'"
          :aria-label="i18n.isZh.value ? '输入你的问题' : 'Type your question'"
          :disabled="busy"
          @keydown.enter.exact.prevent="send"
        ></textarea>
        <button type="submit" class="chat-send" :disabled="busy || !text.trim()" :aria-label="i18n.isZh.value ? '发送' : 'Send'">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, watch } from 'vue'
import { useI18n } from '../lib/i18n'

const i18n = useI18n()
const open = ref(false)
const text = ref('')
const busy = ref(false)
const unread = ref(0)
const messages = ref([])
const scroller = ref(null)
const inputEl = ref(null)
const sid = ref('')
// 进行中的 SSE 流（关闭/清空时中止，避免后台继续生成浪费 token）
let abortCtrl = null

const MSG_KEY = 'oscar_chat_msgs'
const MAX_SAVED = 50

// 多轮流水的会话 id：同一浏览器跨刷新保持上下文
onMounted(() => {
  let s = localStorage.getItem('oscar_chat_sid')
  if (!s) {
    s = (crypto.randomUUID ? crypto.randomUUID() : 'sess-' + Date.now() + '-' + Math.random().toString(16).slice(2))
    localStorage.setItem('oscar_chat_sid', s)
  }
  sid.value = s
  // 恢复历史消息：只存 {kind, content}，恢复时重新转义渲染（localStorage 可能被篡改，绝不直接 v-html）
  try {
    const saved = JSON.parse(localStorage.getItem(MSG_KEY) || '[]')
    if (Array.isArray(saved)) {
      for (const m of saved) {
        if (!m || typeof m.kind !== 'string' || typeof m.content !== 'string') continue
        const safe = (m.kind === 'tool' || m.kind === 'note') ? escapeHtml(m.content) : renderRich(m.content)
        messages.value.push({ kind: m.kind, content: m.content, html: safe })
      }
    }
  } catch { /* 忽略损坏数据 */ }
})

// 打开面板时聚焦输入框
watch(open, (v) => { if (v) nextTick(() => inputEl.value && inputEl.value.focus()) })

const lastKind = computed(() => (messages.value.length ? messages.value[messages.value.length - 1].kind : ''))

// 空态快捷问题（按语言）
const quickQuestions = computed(() => i18n.isZh.value
  ? ['有什么编程书？', '最便宜的书', '本月销量怎么样？', '库存不足的商品']
  : ['Any programming books?', 'Cheapest book', 'Sales this month?', 'Low stock items'])

function close() { open.value = false; abortStream() }
function openChat() { open.value = true }
function ask(q) { text.value = q; send() }
// 中止进行中的 SSE 流（静默，不报网络错误）
function abortStream() {
  if (abortCtrl) { abortCtrl.abort(); abortCtrl = null }
}
// 清空会话：前端历史 + 后端上下文（换新 sessionId）
function clearChat() {
  abortStream()
  busy.value = false
  messages.value = []
  text.value = ''
  unread.value = 0
  try { localStorage.removeItem(MSG_KEY) } catch {}
  sid.value = (crypto.randomUUID ? crypto.randomUUID() : 'sess-' + Date.now() + '-' + Math.random().toString(16).slice(2))
  try { localStorage.setItem('oscar_chat_sid', sid.value) } catch {}
}

// 消息持久化：只存 {kind, content}（重渲染时转义），限制条数
function persist() {
  try {
    const slim = messages.value.slice(-MAX_SAVED).map(m => ({ kind: m.kind, content: m.content }))
    localStorage.setItem(MSG_KEY, JSON.stringify(slim))
  } catch { /* 存储满/隐私模式忽略 */ }
}

function scrollDown() {
  nextTick(() => { if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight })
}

// 最小安全富文本：先 HTML 转义，再 **bold** / `code` / 换行。杜绝 XSS。
function escapeHtml(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function renderRich(t) {
  return escapeHtml(t)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>')
}

function push(kind, content) {
  if (kind === 'delta') {
    const last = messages.value[messages.value.length - 1]
    if (last && last.kind === 'delta') {
      last.content += content
      last.html = renderRich(last.content)
    } else {
      messages.value.push({ kind: 'delta', content, html: renderRich(content) })
    }
  } else {
    // tool/note 是纯文本提示：转义即可（样式 pre-wrap 保留换行）；其余走 renderRich
    const safe = (kind === 'tool' || kind === 'note') ? escapeHtml(content) : renderRich(content)
    messages.value.push({ kind, content, html: safe })
  }
  scrollDown()
  persist()
}

async function send() {
  const msg = text.value.trim()
  if (!msg || busy.value) return
  text.value = ''
  busy.value = true
  unread.value = 0
  push('user', msg)

  try {
    abortCtrl = new AbortController()
    const res = await fetch('/react/api/chat', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, sessionId: sid.value }),
      signal: abortCtrl.signal
    })
    if (!res.ok || !res.body) {
      push('error', i18n.isZh.value ? '连接失败（HTTP ' + res.status + '）' : 'Request failed (HTTP ' + res.status + ')')
      return
    }
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let idx
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue
          let ev = null
          try { ev = JSON.parse(line.slice(5).trim()) } catch { continue }
          if (!ev || !ev.t) continue
          if (ev.t === 'delta') push('delta', ev.d || '')
          else if (ev.t === 'error') push('error', ev.d || 'error')
          else if (ev.t === 'note') {
            const d = ev.d || ''
            push(d.startsWith('tool') ? 'tool' : 'note', d)
          }
          // 'done' → 结束；其余忽略
        }
      }
    }
  } catch (e) {
    // 主动中止（关面板/清空）→ 静默；其余才报网络错误
    if (!(e && (e.name === 'AbortError'))) {
      push('error', i18n.isZh.value ? '网络错误：' + e.message : 'Network error: ' + e.message)
    }
  } finally {
    abortCtrl = null
    busy.value = false
    scrollDown()
    // 收起后未读角标
    if (!open.value && messages.value.length) {
      const last = messages.value[messages.value.length - 1]
      if (last.kind !== 'user' && last.kind !== 'tool' && last.kind !== 'note') unread.value = 1
    }
  }
}
</script>

<style>
.chat-root { position: fixed; right: 20px; bottom: 20px; z-index: 9999; font-family: inherit; }
.chat-fab {
  width: 56px; height: 56px; border-radius: 50%;
  background: var(--accent, #0f766e); color: #fff;
  border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.18); transition: transform 0.15s ease;
}
.chat-fab:hover { transform: scale(1.05); }
.chat-badge {
  position: absolute; top: -4px; right: -4px; min-width: 18px; height: 18px; border-radius: 9px;
  background: var(--danger, #dc2626); color: #fff; font-size: 11px; line-height: 18px; text-align: center; padding: 0 4px;
}
.chat-panel {
  position: absolute; right: 0; bottom: 66px; width: 360px; max-width: calc(100vw - 40px);
  /* 100vh 回退 + dvh：移动端地址栏伸缩时不溢出；safe-area 兜住 iPhone 底部 */
  height: 480px; max-height: calc(100vh - 100px); max-height: calc(100dvh - 100px);
  background: var(--surface, #fff);
  border: 1px solid var(--border, #e5e7eb); border-radius: 14px; overflow: hidden;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.18); display: flex; flex-direction: column;
}
@media (max-width: 480px) {
  .chat-root { right: 12px; bottom: calc(12px + env(safe-area-inset-bottom)); }
  .chat-panel { right: 0; bottom: 64px; max-width: calc(100vw - 24px); }
}
.chat-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 14px; background: var(--accent, #0f766e); color: #fff;
}
.chat-title { font-weight: 600; display: flex; align-items: center; gap: 8px; }
.chat-dot { width: 8px; height: 8px; border-radius: 50%; background: #6ee7b7; }
.chat-close { background: none; border: none; color: #fff; font-size: 22px; line-height: 1; cursor: pointer; }
.chat-clear { background: none; border: none; color: rgba(255,255,255,0.85); font-size: 15px; line-height: 1; cursor: pointer; padding: 2px 4px; }
.chat-clear:hover { color: #fff; }
.chat-body { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.chat-empty { color: var(--muted, #6b7280); font-size: 13px; text-align: center; margin: auto 8px; line-height: 1.5; }
.chat-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 12px 2px; justify-content: center; }
.chat-chips .chip {
  border: 1px solid var(--border, #e5e7eb); background: var(--bg, #f7f6f3); color: var(--accent, #0f766e);
  font-size: 12px; padding: 5px 10px; border-radius: 999px; cursor: pointer; font-family: inherit;
}
.chat-chips .chip:hover { border-color: var(--accent, #0f766e); background: #eef2f2; }
.msg { display: flex; }
.msg.user { justify-content: flex-end; }
.msg-bubble {
  max-width: 82%; padding: 8px 11px; border-radius: 12px; font-size: 13.5px; line-height: 1.5;
  color: var(--ink, #1f2933); white-space: normal; word-break: break-word;
  background: #eef1f4; border-bottom-left-radius: 4px;
}
.msg.user .msg-bubble { background: var(--accent, #0f766e); color: #fff; border-radius: 12px; border-bottom-right-radius: 4px; }
.msg.tool { justify-content: center; }
.msg.tool .msg-bubble {
  background: transparent; color: var(--muted, #6b7280); font-size: 11.5px; padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap;
}
.msg.note .msg-bubble { background: transparent; color: var(--muted, #6b7280); font-size: 12px; padding: 2px 8px; }
.msg.error .msg-bubble { background: #fef2f2; color: var(--danger, #dc2626); border: 1px solid #fecaca; }
.msg-bubble code { background: rgba(0, 0, 0, 0.06); padding: 0 4px; border-radius: 4px; font-size: 12px; }
.typing { color: var(--muted, #6b7280); }
.chat-input {
  display: flex; align-items: flex-end; gap: 8px; padding: 10px; border-top: 1px solid var(--border, #e5e7eb);
}
.chat-input textarea {
  flex: 1; resize: none; border: 1px solid var(--border, #e5e7eb); border-radius: 10px;
  padding: 8px 10px; font-size: 13.5px; font-family: inherit; max-height: 96px; outline: none; background: var(--bg, #f7f6f3);
}
.chat-input textarea:focus { border-color: var(--accent, #0f766e); }
.chat-send {
  width: 38px; height: 38px; border-radius: 10px; border: none; background: var(--accent, #0f766e);
  color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; flex: none;
}
.chat-send:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
