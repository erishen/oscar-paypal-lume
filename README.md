# oscar-paypal-lume

把 [django-oscar-paypal-store](https://github.com/erishen/django-oscar-paypal-store)（Django Oscar 4.1 + PayPal 演示）用
**lume（host：agent-httpd）+ lume-core（语言）+ Vue3** 重写一遍。同一套业务口径：
商品目录 / 搜索 / 购物篮 / 下单 / **PayPal Orders v2（CAPTURE）幂等支付**（sandbox）+
**管理后台**（订单全量 / 真退款 / 商品上下架·库存 / 概览统计）。

> ⚠️ 技术演示 / 作品集项目，PayPal 只跑 **sandbox**，不收真钱（对齐原项目声明）。

## 快速开始

```bash
cp .secrets.json.example .secrets.json   # 填 secret_key + PayPal sandbox 凭据
make init          # 建库建表 + 灌 140 条商品 seed（幂等）
make build-web     # 构建 Vue3 前端 → web/dist（宿主 docroot + SPA fallback）
make create-admin  # 建演示账号 admin/admin123456（等价原项目 quick-admin）
make run           # 默认 127.0.0.1:8090
make smoke             # 23 条断言（静态/Range 206+416/目录/搜索/认证/购物篮）
make smoke-paypal      # 31 条断言（+ 真实调 api-m.sandbox.paypal.com 下单/幂等守卫/取消）
make smoke-admin       # 45 条断言（+ 管理后台：门禁/订单/商品/退款契约）
make test-e2e          # 6 条 Playwright 浏览器 E2E（需系统 Chrome；默认打 18101）
make test-e2e-live     # 1 条真实 PayPal sandbox 全链路 E2E（真下单→访客卡支付→capture→后台 UI 部分退款→退余款）
make test-e2e-live-buyer # 同上但用 buyer 账号登录支付（凭据从 Chrome Keychain 临时解密）
```

浏览器开 `http://127.0.0.1:8090/`：中文/英文（头部 EN|中文 切换）、商品网格、
搜索、详情、购物篮、`Pay with PayPal`（跳 sandbox 登录/审批后回跳 `#/checkout/done`
自动对账 capture）、订单历史。页面右上角固定「演示站点 · DEMO」角标。

## 架构

```
app.lume            路由 + 校验（~930 行）
init.lume           拍平 DDL（7 张表）+ 老库幂等迁移 + seed 灌入
lib/paypal.lume     PayPal Orders v2 门面（OAuth/create/capture/refund，幂等）
lib/{auth,db,support,config}.lume   自 lume-fastapi-web 复用（HMAC 会话、guard 防护、裸 SQL）
web/                Vue3 + Vite/ESBuild SPA（hash 路由 + 自写 i18n/store，零 CDN）
seed/products.json  140 商品（从原 Oscar fixture CSV + 140 张图导出）
static/media/       商品图（/static/media/<sku>.jpg，宿主静态 + Range）
```

宿主 `server { spa = 1; docroot = "./web/dist" }`：未注册路由 + `Accept: text/html`
回退 `index.html`（agent-httpd 原生 SPA history fallback），所以 hash 路由的深链
刷新、PayPal 跳回 URL 都能落到前端。

## 与 Oscar 版的对应关系

| 原项目（Django/Oscar） | 本项目（lume/Vue3） | 口径 |
|---|---|---|
| Oscar catalogue/basket/order 模型 | 拍平 7 张表（products/baskets/basket_items/orders + rate_limits/visits） | 演示切片，不需要 Oscar 30+ 张表 |
| `facade.py` PayPal Orders v2 | `lib/paypal.lume` | 1:1 移植：token 缓存、create 全新 Request-Id、capture 先 GET 对账 + 稳定 Request-Id + `ORDER_ALREADY_CAPTURED` 视为成功；出站统一 `request()`：网络错误重试 3 次，GET/OAuth 另对 429/5xx 重试，写操作靠幂等键不重放 5xx |
| 金额 Decimal | 整数分（`price_cents`），`money2()` 出两位小数 | 避免浮点 |
| `basket.currency`（Oscar 默认 GBP） | `CURRENCY` 环境变量，默认 USD | `CURRENCY=GBP make run` 对齐原 sandbox；订单与 PayPal 金额始终同源 |
| 搜索（Haystack/Whoosh） | SQL `LIKE`（name/description） | 140 条数据够用 |
| dashboard 真退款（含部分退款） | `POST /api/admin/orders/:id/refund` | 省略 `amount_cents`=全额；传整数分=部分退款，订单保持 paid 直至退满；本地 key 去重 + PayPal 侧稳定 `PayPal-Request-Id` 双层幂等；全额才回补库存并转 refunded |
| django.po i18n | 前端字典 i18n（en / 中文） | 头部 EN\|中文 切换 |
| 模板 + DEMO 角标 | Vue3 SPA + 固定角标 | |

## 与 lume 的适配点（踩过的坑）

- **`run()` 必须显式调用**：lume 脚本末尾不调 `run()` 就正常退出（rc=0 且无输出），
  服务不会起来。`make check` 只 parse，不暴露这个问题。
- **`http_get/http_post` 不抛异常**：网络失败写进结果 map 的 `err` 字段（`status=0`）。
  **不要用 `try()` 包**——try 会把响应塞进 `.ok`，外层读 `status`/`body` 全拿到默认值
  （曾误报 "PayPal OAuth 失败 HTTP 0"，实际 sandbox 是通的）。
- **类型检查器的 map 字段规则**：map 字面量初始化后动态 `m.newfield = x` 会报
  `type has no field`，所有 map 初始值就要带全字段。
- **int/float 混合算术**：`int(c/100)*100` 会被拒（"arithmetic needs numbers"），
  `money2()` 用纯字符串切片实现。
- **SQLite 不自动建库**：`sql_write` 打开不带 create 标志，`make init` 先
  `sqlite3 .data/app.db ""` 预创建。
- **路由 handler 闭包内可引用后定义的 `func`**（运行时求值），但**路由注册引用**
  的函数必须在解析期已存在（fastapi-web 全是内联闭包，照抄最稳）。
- **前端构建**：macOS 沙箱下 rollup 原生二进制 Team ID 校验失败（dlopen 拒载），
  Vite 跑不了；构建器切到 **esbuild**（原生二进制可用）+ `@vue/compiler-sfc`，
  单 IIFE 文件、无 chunk（静态托管无懒加载坑）。
- **smoke 断言**：`curl | python3` 管道在脚本里偶发拿空，改成先落临时文件再解析。

## 验收记录

- 2026-11-19（本机 8090）：
  - `make check`：parse OK
  - `make smoke`：**23/0**（SPA fallback / 静态 + Range 206/416/404 / 路径穿越 /
    目录 140 条 / 搜索 / 详情 / 登录 / 购物篮增删改查 + 401 门禁 + product_id 映射）
  - `make smoke-paypal`：**31/0**，其中真实调 PayPal sandbox：
    - `POST /api/orders/` → 201 + `approve_url=https://www.sandbox.paypal.com/checkoutnow?token=…`
    - 未 approve 就 capture → 422 `ORDER_NOT_APPROVED` 被幂等守卫拒绝（HTTP 502，订单转 `failed`，不重复扣款）
    - 新订单 cancel → `canceled`；重复 cancel → 404（幂等）
- 2026-11-20（管理后台二期，本机 8090）：
  - `make smoke-admin`：**45/0**（基础 23 + PayPal 8 + admin 14）：
    - 门禁：guest 401 / customer 403 / admin 放行
    - 订单：全量列表（含 username）、by-id、404、按状态过滤
    - 商品：上下架 PATCH、库存/价格调整、未上架商品不进目录
    - 退款契约：paid 无 capture → 400；假 capture 真调 PayPal → 5xx 不炸；已 refunded 重复退款 → 200 already（幂等）
    - 退款成功后回补库存 + 订单转 `refunded`（对齐原 dashboard 口径）
- 2026-11-21（与 [django-oscar-paypal-store](https://github.com/erishen/django-oscar-paypal-store) 对齐补强）：
  - 服务端出站重试 3 次（网络错误；GET/OAuth 另含 429/5xx），对齐 `facade.py` 的 `Retry` + `_post`
  - 退款加稳定 `PayPal-Request-Id`，支持部分退款（`amount_cents`）/累计 `refunded_cents`，本地 key 去重
  - 货币改 `CURRENCY` 配置（默认 USD，`CURRENCY=GBP` 对齐 Oscar），库存只在全额退款后回补
  - 补齐 `rate_limits` / `visits` 建表 + 老库 `orders` 退款字段幂等迁移；移除 `doc_log_api_key` 死配置
  - 回归：`make check` / init parse OK；容器 healthy；`docker-smoke` 23/0 + 完整 45/0；真链路三轮（订单 61/62/67）均通过，含部分退款 → 退余款 → 幂等
- 2026-11-21（前端 UI 对齐补强）：
  - 后台订单列表增加金额输入 + 「退款 / 全额退款」，真链路 E2E 用 UI 完成部分退（仍 paid、累计已退）再用 API 退余款
  - 后台商品列表可改价（连同库存一次 PATCH `price_cents`），E2E 自动改回原价
  - 未登录加购/访问受限写入 `oscar_next`，登录后回原页面；来源只消费一次，显式登录仍落购物篮
  - 英文补 `status`，首屏等 `/auth/me` 回来再挂载视图，消除未登录态竞态
  - 回归：`test-e2e` 6/6；真链路订单 67（后台 UI 部分退款）通过

## 浏览器 E2E（Playwright）

`scripts/smoke.sh` 只打 HTTP API，覆盖不到前端交互。新增的 E2E 走真实 Chrome，直接操作页面：

```bash
make docker-up        # 或确保 18101 上已有实例
make test-e2e         # 默认 E2E_BASE_URL=http://127.0.0.1:18101
# 换个地址：E2E_BASE_URL=http://127.0.0.1:20102 make test-e2e
```

- 不下载 Playwright 自带浏览器：配置用 `channel: 'chrome'` 直接调本机 Google Chrome，并加 `--no-proxy-server` 避免本地请求被代理接走。
- 6 条用例：登录 → 加购/改数量/删除（覆盖 product_id 映射 bug）、结算页金额按美元显示、`#/checkout/done?key=...&token=...` 对账回跳渲染（API 用 `page.route` 打桩，不真调 PayPal）、管理后台状态筛选返回 200（覆盖尾斜杠 bug）、后台改价保存后前后端一致、未登录加购后登录回原页面且来源只消费一次。
- 用例之间用 API 清购物篮，单 worker 串行跑，不并发污染演示库；失败时保留 trace 和截图到 `/tmp/oscar-lume-playwright-results/`（放临时目录，避免触发沙箱的批量删除保护）。

### 真实 PayPal sandbox 全链路 E2E（下单 → 支付 → 退款）

上面 4 条 E2E 和 `scripts/smoke.sh` 的 PayPal 段都**不产生真实交易**（capture 被守卫拒绝或用 `page.route` 打桩）。`web/e2e/live-paypal.spec.js` 是唯一的真链路用例，全程真调 `api-m.sandbox.paypal.com`：

```bash
make docker-up
make test-e2e-live          # 访客卡支付；需显式目标，默认 test-e2e 不含此用例
make test-e2e-live-buyer    # buyer 账号登录支付（自动从 Chrome Keychain 读凭据）
```

覆盖：登录 → 加购（选有库存商品）→ 真实 create order → PayPal sandbox 支付 → 回跳 → 真实 capture（订单转 paid、扣库存、清篮）→ **管理后台 UI 部分退款**（填金额点「退款」，退一半：仍 paid、累计 `refunded_cents`、库存不回补；同金额重复退款 200 already）→ **退余款**（转 refunded、回补库存）→ 再次退款幂等。

两种支付模式：

| 模式 | 命令 | 说明 |
|---|---|---|
| **访客卡**（默认） | `make test-e2e-live` | 走"使用借记卡或信用卡付款"，用 sandbox 公开测试卡 `4111111111111111` / `12/28` / `123`（可用 `PAYPAL_TEST_CARD`/`PAYPAL_TEST_EXP`/`PAYPAL_TEST_CVV` 覆盖） |
| **buyer 账号** | `make test-e2e-live-buyer` | 用真实 sandbox buyer 账号登录 approve，选 PayPal 余额/绑定卡后点"完成购物"，**不用填卡表单**；凭据由 `scripts/buyer-creds.sh` 从本机 Chrome 保存的登录 + Keychain 临时解密，不写仓库、不打印 |

- buyer 账号来源：本机 Chrome 保存的 `sb-*@personal.example.com`（sandbox buyer）登录，密码经 `Chrome Safe Storage` 密钥解密。脚本优先选 personal 账号；可 `BUYER_EMAIL` / `BUYER_PASS` 手动覆盖。
- 注意容器网络到 `api-m.sandbox.paypal.com` 可能 TLS 失败（DNS 被劫持到 `zscloudsafe.com`）；遇到 503 时可在宿主机 `PORT=20102 <lume> app.lume` 起服务并 `E2E_BASE_URL=http://127.0.0.1:20102 make test-e2e-live-buyer`。
- sandbox 只模拟资金流，不产生真实扣款；但会在你的 PayPal sandbox 商户后台留下真实的交易与退款记录。
- 商户凭据仍从 `.secrets.json` 读（`paypal_client_id` / `paypal_client_secret` / `paypal_mode`），与 [django-oscar-paypal-store](https://github.com/erishen/django-oscar-paypal-store)/.env 里的三项完全一致。
- PayPal sandbox 偶发 5xx/限流，create 环节带 3 次退避重试；真实链路约 1 分钟。
- 跑完自动清购物篮；订单留在演示库里便于在 PayPal 后台对账，需要干净演示库时手动 `DELETE FROM orders WHERE id>1` 即可。

## Docker 部署（端口 18101，>10000）

```bash
make docker-build     # 生成单一构建上下文并编译镜像（Linux 侧重编 lume + 烧入前端产物）
make docker-up        # 起容器：127.0.0.1:18101，自动建库/灌 140 商品/建管理员
make docker-smoke     # 容器内验收（基础 23 + PayPal/admin 段按需）
make docker-down      # 停容器（数据卷保留）
```

- 构建上下文由 `make docker-context` 组装（lume 工具链 + agent-httpd + 应用），
  运行期镜像是 slim（只带 `libsqlite3/libssl3/sqlite3/openssl/curl/tini` + 预编 lume）。
- **端口**：默认 `DPORT=18101`（宿主只绑回环）。改端口 `DPORT=19101 make docker-up`
  （容器与宿主同步改）。
- **管理员口令**：不传 `ADMIN_PASSWORD` 时 entrypoint 生成随机口令写入数据卷
  `.secrets.json`（不打印到日志）；本地演示可 `ADMIN_PASSWORD=admin123456 docker compose up -d`
  与 Oscar quick-admin 对齐。
- **PayPal 凭据（可选）**：`PAYPAL_CLIENT_ID=… PAYPAL_CLIENT_SECRET=… PAYPAL_MODE=sandbox \
  docker compose up -d`；不提供时站点/目录/购物篮照常，下单返回 503。
- 数据卷 `oscar-lume-data` 挂 `/app/.data`（SQLite + 密钥）；重建容器不丢数据。
- `make docker-smoke` 的 DB 层验收通过 `SMOKE_DB_CMD`/`SMOKE_USER_CMD`
  （`docker compose exec` 进容器）打通；本地跑法不变（默认 `sqlite3 .data/app.db`）。

## 已知边界

- 退款只对带 `paypal_capture_id` 的 paid 订单有效；演示库手工造的 paid 订单（无 capture id）退不了——这是**正确的契约行为**（有钱才退），smoke-admin 用它验证 400。
- 部分退款：`POST .../refund` 带 `amount_cents` 时只退指定金额，订单保持 `paid` 并累计 `refunded_cents`；退满后转 `refunded`。重复传同一个 `key`（或同金额默认 key）返回 200 already，不会重复记账/重复调 PayPal。
- 优惠券折扣会写进 PayPal 建单的 `breakdown.discount`（行项目保持原价，`item_total` = 行项目合计）；
  否则 PayPal 校验 `ITEM_TOTAL_MISMATCH`（422）。带券建单已在 sandbox 实测通过。
- lume 路由按注册顺序匹配：字面量路由（如 `delete /api/basket/voucher`）必须注册在参数路由
  （`delete /api/basket/:product_id`）之前，否则会被参数路由吃掉返回 422。
- 限流 / IP 名单只对已注册的 API 路由生效（未注册路径走宿主 docroot，不过
  `guard()`）；演示单实例够用，与 fastapi-web「任意 path 都过 guard」不同。
- `smoke.sh` 的 DB 层退款探针经 `SMOKE_DB_CMD` 用独立 `sqlite3` 连接写库；SQLite CLI
  默认 `busy_timeout=0`，活跃请求写 `visits`/`rate_limits` 时探针会瞬时
  `database is locked`（应用连接自带 5s busy_timeout，不受影响）。脚本对探针写锁
  做了最多 3 次退避重试，避免偶发误报。
- 多 worker 下 PayPal token 缓存是进程内（每 worker 各一份），OAuth 调用略增，无正确性问题。
- 新版 lume（弹性 worker 池）把**所有**已注册脚本路由的请求送进阻塞池（含无 body 的 GET）：
  worker 数太小（默认 2）时并发会排队 5s 后回 503（不落日志，表现为 E2E 随机挂）。
  docker-compose 已把 `WORKERS` 默认调到 8；套件从 ~2.8min 降到 ~50s。
- 库存扣减在支付成功时发生（Oscar 在 fulfill 时扣），**全额**退款时回补；部分退款不回补（未指定退哪些行）；演示口径。
- 无迁移工具：schema 变更改 `init.lume` 幂等 DDL。
- 安全/合规面：宿主导出的 HTML 带 CSP meta（`script-src 'self' 'nonce-…'`，内联 JSON-LD
  用固定 nonce 放行；`style-src 'unsafe-inline'` 因 Vue 运行期注入 `<style>`）；口令重置
  token 落库只存 HMAC 哈希（明文仅在响应/邮件出现一次）；内容页含 `/privacy/` 与
  `/terms/`（演示数据最小化 + 不处理真实资金 + AI 助手数据流转披露）。
- `DEBUG` 等价面：错误体在 `APP_ENV=production` 时 fail-closed 文案（沿用 fastapi-web 口径）。
- admin 用户由 `make create-admin` 生成（`admin/admin123456`），与 Oscar `quick-admin` 对齐；
  生产部署应改用 `scripts/create-user.lume <user> <pass> admin` 并配强口令。
