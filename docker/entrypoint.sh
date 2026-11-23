#!/bin/sh
# 容器入口：补齐配置 → 预建 SQLite → 建库/灌 seed/建管理员 → 前台跑服务
# 幂等：重复启动不会重建已存在的密钥、商品或管理员。
set -eu
umask 077

APP_DIR="${APP_DIR:-/app}"
DATA_DIR="${DATA_DIR:-$APP_DIR/.data}"
CONF_FILE="${CONF_FILE:-$DATA_DIR/.secrets.json}"
SECRETS="$CONF_FILE"
LUME_BIN="${LUME_BIN:-/usr/local/bin/lume}"
DB="$APP_DIR/.data/app.db"

mkdir -p "$DATA_DIR" "$APP_DIR/logs"
chmod 700 "$DATA_DIR" 2>/dev/null || true

# 数据卷由 root 建出来时普通用户写不进去，早点报清楚
if ! touch "$DATA_DIR/.write-probe" 2>/dev/null; then
    echo "[entrypoint] $DATA_DIR 不可写（uid=$(id -u)）；挂载卷请 chown 后重启" >&2
    exit 1
fi
rm -f "$DATA_DIR/.write-probe"

# ---- 1. 应用配置（.secrets.json 必须落文件：DSL 的 env() 会掩码 SECRET 类变量）----
# PayPal 凭据走 env 注入（演示用途），缺失留空：下单链路不可用但站点照常。
if [ ! -f "$SECRETS" ]; then
    ADMIN_USER="${ADMIN_USERNAME:-admin}"
    ADMIN_PASS="${ADMIN_PASSWORD:-}"
    if [ -z "$ADMIN_PASS" ]; then
        ADMIN_PASS="$(openssl rand -hex 12)"
        echo "[entrypoint] 未提供 ADMIN_PASSWORD，已生成随机口令写入 $SECRETS（600）；请查看该文件，口令不打印到日志" >&2
    fi
    cat > "$SECRETS" <<EOF
{
  "secret_key": "$(openssl rand -hex 32)",
  "admin_username": "$ADMIN_USER",
  "admin_password": "$ADMIN_PASS",
  "paypal_client_id": "${PAYPAL_CLIENT_ID:-}",
  "paypal_client_secret": "${PAYPAL_CLIENT_SECRET:-}",
  "paypal_mode": "${PAYPAL_MODE:-sandbox}"
}
EOF
    chmod 600 "$SECRETS"
    echo "[entrypoint] 已生成 $SECRETS（secret_key 每次安装只生成一次）"
fi

# ---- 2. SQLite 预建（lume 的 sql_write 打开不带 create 标志）----
sqlite3 "$DB" "SELECT 1;"

# config.lume 用 env("CONF_FILE") 定位密钥文件，必须 export 给 lume 子进程
export CONF_FILE

# ---- 3. 建表 + 灌 seed（幂等：products 非空则跳过）----
"$LUME_BIN" init.lume

# ---- 3.4 幂等索引（lume sql_write 护栏只放 CREATE TABLE/ADD COLUMN，走 CLI 建索引）----
# 商品列表/详情、订单、评价、访问统计等高频查询避免全表扫 + temp sort。
sqlite3 -bail "$DB" <<'IDX' || echo "[entrypoint] warn: 建索引失败（查询仍可用，只是变慢）" >&2
PRAGMA busy_timeout=5000;
CREATE INDEX IF NOT EXISTS idx_products_cat_name ON products (displayable, category, name);
CREATE INDEX IF NOT EXISTS idx_products_slug ON products (slug);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders (created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews (product_id, status);
CREATE INDEX IF NOT EXISTS idx_visits_created ON visits (created);
IDX

# ---- 3.5 Agent text2sql 只读快照（去 PII，只留目录/订单汇总/评价）----
# lume 的 sql_query/sql_tables/sql_schema（text2sql）在 SQLITE_DB 指向已存在文件时
# 注册。这里从 app.db 抽安全列建成独立快照 agent.db：不含 users/user_addresses/
# password_resets/wishlists/baskets（邮箱/口令/地址/用户绑定）与 orders 的
# user_id/guest_email/voucher_code —— 模型无论写什么 SQL 都读不到 PII。
AGENT_DB="$DATA_DIR/agent.db"
build_agent_db() {
    tmp="$AGENT_DB.tmp"
    rm -f "$tmp"
    # 原子重建：先写 tmp，成功后 mv 覆盖。sql_query 打开的旧 inode 不受 mv 影响，
    # 每次查询都看到完整一致的快照。busy_timeout 等 lume 的短写锁（rollback journal）。
    if ! sqlite3 -bail "$tmp" <<SQL
PRAGMA busy_timeout=5000;
ATTACH '$DB' AS src;
CREATE TABLE products AS SELECT * FROM src.products;
CREATE TABLE orders AS SELECT id, order_no, status, total_cents, currency, item_count, items_json, created_at, paid_at, refunded_cents, discount_cents FROM src.orders;
CREATE TABLE vouchers AS SELECT * FROM src.vouchers;
CREATE TABLE flatpages AS SELECT * FROM src.flatpages;
CREATE TABLE reviews AS SELECT id, product_id, title, body, score, status, created_at FROM src.reviews;
SQL
    then
        rm -f "$tmp"
        echo "[entrypoint] warn: agent 快照重建失败（app.db 忙？），保留旧快照" >&2
        return 1
    fi
    mv -f "$tmp" "$AGENT_DB"
    return 0
}
build_agent_db || true

# ---- 3.6 周期刷新 agent.db（text2sql 看到近实时数据，不再只是启动快照）----
# AGENT_DB_REFRESH 秒（默认 30；0=关闭，退化为启动快照）。原子 mv 保证 sql_query
# 不读半成品；失败保留旧快照，下轮再试。
AGENT_DB_REFRESH="${AGENT_DB_REFRESH:-30}"
if [ "$AGENT_DB_REFRESH" -gt 0 ] 2>/dev/null; then
  ( while true; do sleep "$AGENT_DB_REFRESH"; build_agent_db || true; done ) &
  echo "[entrypoint] agent 快照每 ${AGENT_DB_REFRESH}s 刷新（后台）"
fi

# ---- 3.7 孤儿会话清理（保守：只删超 7 天的会话文件，绝不碰近期活跃会话）----
# lume 内部工具/聊天会话存 $DATA_DIR/sessions/sess-*.json；无内置 TTL，长跑会累积。
# 每 1h 清一次超过 SESSION_TTL_DAYS（默认 7 天）的（按 mtime），避免误删进行中会话。
SESSION_DIR="$DATA_DIR/sessions"
SESSION_TTL_DAYS="${SESSION_TTL_DAYS:-7}"
( while true; do
    sleep 3600
    if [ -d "$SESSION_DIR" ]; then
      find "$SESSION_DIR" -maxdepth 1 -type f -name 'sess-*.json' -mtime +"$SESSION_TTL_DAYS" -delete 2>/dev/null || true
    fi
  done ) &
echo "[entrypoint] 孤儿会话清理（>${SESSION_TTL_DAYS}天，每小时一次）"

# ---- 4. 建演示管理员（幂等：已存在则跳过；口令取自 secrets，避免 argv 泄漏）----
"$LUME_BIN" scripts/create-user.lume "" "" admin || true

# ---- 5. 前台跑服务（tini 回收僵尸进程）----
echo "[entrypoint] 启动 oscar-paypal-lume（PORT=${PORT:-18101}）"
exec "$LUME_BIN" app.lume
