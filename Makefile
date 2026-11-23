LUME ?= ../../../work/lume/lume/bin/lume
PORT ?= 8090
BASE ?= http://127.0.0.1:$(PORT)
E2E_BASE_URL ?= http://127.0.0.1:18101
# npm 可能不在 make 的 /bin/sh PATH 里（nvm），做一次探测兜底
NPM_CMD ?= $(shell { command -v npm 2>/dev/null; ls "$$HOME/.nvm/versions/node/"*/bin/npm 2>/dev/null; } | head -1)
NODE_CMD ?= $(shell { command -v node 2>/dev/null; ls "$$HOME/.nvm/versions/node/"*/bin/node 2>/dev/null; } | head -1)

.PHONY: help check init create-admin dev run stop smoke smoke-paypal smoke-admin test-e2e test-e2e-live test-e2e-live-buyer build-web docker-context docker-build docker-up docker-down docker-smoke clean

help: ## 显示可用目标
	@grep -E '^[a-z0-9-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-12s %s\n", $$1, $$2}'

check: ## 语法 + 类型检查（不产生副作用）
	$(LUME) --check app.lume

init: ## 建库建表 + 灌 seed（幂等；需 .secrets.json）
	@test -f .secrets.json || (echo "缺少 .secrets.json，先 cp .secrets.json.example .secrets.json 并填值"; exit 1)
	@test -d .data || mkdir -p .data
	# lume 的 sql_write 打开 SQLite 不带 create 标志，新库文件必须预先存在
	@test -f .data/app.db || sqlite3 .data/app.db "SELECT 1;"
	$(LUME) init.lume

create-admin: ## 建演示账号 admin/admin123456（对齐 Oscar quick-admin）
	$(LUME) scripts/create-user.lume admin admin123456 admin

dev: ## 热重载开发
	PORT=$(PORT) $(LUME) --watch app.lume

run: ## 常驻运行
	PORT=$(PORT) $(LUME) app.lume

stop: ## 停掉本地实例
	-pkill -f 'lume app.lume' || true

# ---- 前端（esbuild 单文件构建 → web/dist，宿主 SPA fallback 兜底）----
build-web: ## 构建 Vue3 前端到 web/dist（宿主 docroot 指向 ./web/dist）
	cd web && $(NPM_CMD) install --no-audit --no-fund && $(NODE_CMD) build.mjs
	@test -f web/dist/index.html || { echo "build 失败：缺 web/dist/index.html"; exit 1; }
	@echo "→ docroot web/dist ready"

# ---- Docker（多阶段：Linux 工具链编 lume → slim 运行期；端口 >10000）----
DOCKER_BIN ?= $(shell command -v docker || echo /usr/local/bin/docker)
LUME_DIR ?= ../../../work/lume/lume
DOCKER_CONTEXT ?= .docker/ctx
DOCKER_IMAGE ?= oscar-paypal-lume:dev
COMPOSE_PROJECT ?= oscar-paypal-lume
DPORT ?= 18101

docker-context: build-web ## 生成单一构建上下文（lume host + agent-httpd + 本应用）
	rm -rf $(DOCKER_CONTEXT) && mkdir -p $(DOCKER_CONTEXT)
	rsync -a --exclude .git --exclude build --exclude bin --exclude .DS_Store \
	    --exclude build-asan --exclude frontend --exclude node_modules \
	    --exclude cgi-bin --exclude logs --exclude 'www/dist' \
	    --exclude '.venv*' --exclude 'serena-src' --exclude '*.so' \
	    $(LUME_DIR)/ $(DOCKER_CONTEXT)/lume/
	rsync -a --exclude .git --exclude .data --exclude logs --exclude .docker \
	    --exclude .secrets.json --exclude '*.db' --exclude .DS_Store \
	    --exclude web/node_modules --exclude skills \
	    ./ $(DOCKER_CONTEXT)/app/
	cp docker/Dockerfile docker/entrypoint.sh $(DOCKER_CONTEXT)/

docker-build: docker-context ## 编镜像
	$(DOCKER_BIN) build -t $(DOCKER_IMAGE) $(DOCKER_CONTEXT)

docker-up: docker-context ## 起容器（端口 $(DPORT)/18101，自动建库/灌 seed/建管理员）
	PORT=$(DPORT) $(DOCKER_BIN) compose -p $(COMPOSE_PROJECT) up -d --build
	@echo "→ http://127.0.0.1:$(DPORT)（admin 口令在 .data 卷的 .secrets.json）"

docker-down: ## 停容器（数据卷保留）
	$(DOCKER_BIN) compose -p $(COMPOSE_PROJECT) down

docker-smoke: ## 容器冒烟（需先 make docker-up；DB 层验收走容器内 sqlite3/lume）
	BASE=http://127.0.0.1:$(DPORT) \
	SMOKE_DB_CMD="$(DOCKER_BIN) compose -p $(COMPOSE_PROJECT) exec -T web sqlite3 /app/.data/app.db" \
	SMOKE_USER_CMD="$(DOCKER_BIN) compose -p $(COMPOSE_PROJECT) exec -T web /usr/local/bin/lume scripts/create-user.lume" \
	LUME="" ./scripts/smoke.sh

smoke: ## 冒烟（需先 make run）
	BASE=$(BASE) ./scripts/smoke.sh

smoke-paypal: ## 冒烟 + PayPal sandbox 真实下单链路（需先 make run）
	BASE=$(BASE) ./scripts/smoke.sh yes

smoke-admin: ## 冒烟 + 管理后台（门禁/订单/商品/退款契约；需先 make run）
	BASE=$(BASE) LUME=$(LUME) ./scripts/smoke.sh yes yes

test-e2e: ## Playwright 浏览器 E2E（需先 docker-up；默认打 18101，使用系统 Chrome）
	cd web && E2E_BASE_URL=$(E2E_BASE_URL) $(NPM_CMD) run test:e2e

test-e2e-live: ## 真实 PayPal sandbox 全链路（下单→访客卡支付→capture→退款；真调 PayPal）
	cd web && E2E_BASE_URL=$(E2E_BASE_URL) E2E_LIVE=1 $(NPM_CMD) run test:e2e -- e2e/live-paypal.spec.js

test-e2e-live-buyer: ## 真实 PayPal 全链路（buyer 账号登录支付；凭据从 Chrome Keychain 临时解密）
	@eval "$$(sh scripts/buyer-creds.sh)" && \
	cd web && E2E_BASE_URL=$(E2E_BASE_URL) E2E_LIVE=1 PAYPAL_LOGIN=1 $(NPM_CMD) run test:e2e -- e2e/live-paypal.spec.js

clean: ## 清日志
	rm -f logs/*.log
