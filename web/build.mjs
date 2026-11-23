// build.mjs —— esbuild 单文件构建（Vite native rollup 在沙箱 Team ID 校验下不可用）
// 产物：dist/index.html + dist/assets/app.js + dist/assets/style.css（单 IIFE，无 chunk）
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import esbuild from 'esbuild'
import { parse, compileScript, compileTemplate, compileStyle } from '@vue/compiler-sfc'

const __dirname = dirname(fileURLToPath(import.meta.url))
const dist = join(__dirname, 'dist')
await rm(dist, { recursive: true, force: true })
await mkdir(join(dist, 'assets'), { recursive: true })

// ---- .vue SFC → JS 模块（script setup + 全局模板，非 scoped）----
const vueLoader = {
  name: 'vue-sfc',
  setup(build) {
    build.onLoad({ filter: /\.vue$/ }, async (args) => {
        const source = await readFile(args.path, 'utf8')
        const id = args.path.replace(/\\/g, '/')
        const { descriptor, errors } = parse(source, { filename: id })
        if (errors.length) throw new Error('SFC parse error in ' + id + ': ' + errors[0].message)

        const script = compileScript(descriptor, { id, inlineTemplate: false })
        const tpl = compileTemplate({
          id,
          filename: id,
          source: descriptor.template ? descriptor.template.content : '',
          scoped: false,
          compilerOptions: { bindingMetadata: script.bindings }
        })
        if (tpl.errors.length) throw new Error('template error in ' + id + ': ' + tpl.errors[0])

        // 合并：script 的 default export + template 的 render + 组件内样式
        let code = script.content.replace(/export default/, 'const __sfc__ =')
        if (descriptor.template) {
          code += '\n' + tpl.code.replace('export function render', 'function render')
          code += '\n__sfc__.render = render;'
        }
        let css = ''
        for (const st of descriptor.styles || []) {
          css += compileStyle({ source: st.content, id, filename: id }).code + '\n'
        }
        if (css.trim()) {
          code += `;const __css__ = ${JSON.stringify(css)};` +
            `const __link__ = document.createElement('style');__link__.textContent = __css__;` +
            `document.head.appendChild(__link__);`
        }
        code += '\nexport default __sfc__;'
        return { contents: code, loader: 'js', resolveDir: dirname(args.path) }
    })
  }
}

// ---- 入口（content-hash 文件名：内容变则新名 → 可 immutable 强缓存）----
const jsBuild = await esbuild.build({
  entryPoints: [join(__dirname, 'src/main.js')],
  bundle: true,
  minify: true,
  sourcemap: false,
  outdir: join(dist, 'assets'),
  entryNames: 'app-[hash]',
  format: 'iife',
  platform: 'browser',
  logLevel: 'info',
  metafile: true,
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.PROD': 'true',
    'import.meta.env.DEV': 'false',
    'import.meta.env': '{}',
    '__VUE_OPTIONS_API__': 'true',
    '__VUE_PROD_DEVTOOLS__': 'false',
    '__VUE_PROD_HYDRATION_MISMATCH_DETAILS__': 'false'
  },
  plugins: [vueLoader]
})

// ---- 全局样式（主应用）----
const cssBuild = await esbuild.build({
  entryPoints: [join(__dirname, 'src/assets/style.css')],
  bundle: true,
  minify: true,
  sourcemap: false,
  outdir: join(dist, 'assets'),
  entryNames: 'style-[hash]',
  logLevel: 'silent',
  metafile: true
})

// 从 metafile 拿实际（带 hash）文件名；找不到则回退旧名（build 异常时下面会抛）
function outName(build, fallback) {
  const outs = Object.keys((build && build.metafile && build.metafile.outputs) || {})
  if (outs.length) return outs[0].split('/').pop()
  return fallback
}
const jsName = outName(jsBuild, 'app.js')
const cssName = outName(cssBuild, 'style.css')

// index.html（hash 路由；资源用相对路径，docroot 任意挂载点都能工作）
const html = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="description" content="Lume 书店 —— Django Oscar + Lume 重写的书店演示：商品目录、搜索、购物篮、结算、PayPal 沙箱支付、退款全链路，含 AI 商店助手。" />
  <meta name="theme-color" content="#0f766e" />
  <meta property="og:title" content="Lume 书店" />
  <meta property="og:description" content="Lume 书店 —— 图书目录、购物篮、PayPal 沙箱支付全链路，含 AI 商店助手。" />
  <meta property="og:type" content="website" />
  <!-- CSP（meta 覆盖宿主导出的 HTML 文档；frame-ancestors 仅响应头可强制，这里交给
       API 响应的 X-Frame-Options）。script-src 用固定 nonce 放行内联 JSON-LD（结构化数据，
       非可执行），阻止注入的内联脚本；style 留 'unsafe-inline' 因 Vue SFC 运行期注入
       <style> 与 :style 绑定。资源全部同源，零 CDN。 -->
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'nonce-lume2026'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'" />
  <title>Lume 书店 · DEMO</title>
  <script type="application/ld+json" nonce="lume2026">
  {
    "@context": "https://schema.org",
    "@type": "BookStore",
    "name": "Lume 书店",
    "alternateName": "Lume Books",
    "description": "Lume 书店（lume 重写的 Django Oscar PayPal 演示）：图书目录、搜索、购物篮、PayPal 沙箱支付与退款，含 AI 商店助手。",
    "currenciesAccepted": "USD",
    "paymentAccepted": "PayPal"
  }
  </script>
  <link rel="stylesheet" href="assets/${cssName}" />
  <link rel="icon" href="data:," />
</head>
<body>
  <div id="app"></div>
  <script src="assets/${jsName}"></script>
</body>
</html>
`
await writeFile(join(dist, 'index.html'), html)
console.log('build ok → dist/ (index.html + assets/)')
