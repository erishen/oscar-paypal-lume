#!/bin/bash
# smoke.sh —— oscar-paypal-lume 冒烟（需先 make run）
# 用法：BASE=http://127.0.0.1:8090 ./scripts/smoke.sh [paypal]
set -u
BASE="${BASE:-http://127.0.0.1:8090}"
WITH_PAYPAL="${1:-no}"
WITH_ADMIN="${2:-no}"

pass=0; fail=0
chk() { # chk <desc> <want> <got>
  if [ "$2" = "$3" ]; then pass=$((pass+1)); else fail=$((fail+1)); echo "FAIL: $1 (want $2, got $3)"; fi
}
jget() { python3 -c "import sys,json;d=json.load(sys.stdin);print($1)" 2>/dev/null; }

# dbx <sql> —— 执行一次 SQLite 探针（经 SMOKE_DB_CMD），遇瞬时写锁
# （"database is locked"）重试最多 3 次（退避 1s）。
# sqlite3 CLI 默认 busy_timeout=0：活跃请求写 visits/rate_limits 时探针写入会
# 立刻 SQLITE_BUSY；应用连接自带 5s busy_timeout（见 lume sqlite_tool.c），这里
# 补齐探针侧等待。stdout 透传给调用方（SELECT 取 id 等），stderr 非锁错误照常输出。
dbx() {
  local sql="$1" n=0 errf
  errf=$(mktemp)
  while :; do
    if $SMOKE_DB_CMD "$sql" 2>"$errf"; then
      rm -f "$errf"
      return 0
    fi
    if grep -q "database is locked" "$errf" 2>/dev/null; then
      n=$((n+1))
      if [ "$n" -ge 3 ]; then
        cat "$errf" >&2
        rm -f "$errf"
        return 1
      fi
      sleep 1
    else
      cat "$errf" >&2
      rm -f "$errf"
      return 1
    fi
  done
}

# ---- 前端静态 ----
chk "SPA / → DOCTYPE" "true" "$(curl -s "$BASE/" | grep -q '<!DOCTYPE html>' && echo true || echo false)"
chk "SPA /basket fallback" "true" "$(curl -s -H 'Accept: text/html' "$BASE/basket" | grep -q '<!DOCTYPE html>' && echo true || echo false)"
# SPA 产物是 content-hash 文件名（app-<hash>.js / style-<hash>.css）：从 index.html 解析实际引用
APP_JS=$(curl -s "$BASE/" | grep -oE 'assets/app-[A-Za-z0-9_-]+\.js' | head -1)
STYLE_CSS=$(curl -s "$BASE/" | grep -oE 'assets/style-[A-Za-z0-9_-]+\.css' | head -1)
chk "assets/app.js 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$APP_JS")"
chk "assets/style.css 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/$STYLE_CSS")"

# ---- 商品图（Range + 404）----
SKU="9780131103627"
chk "media 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/static/media/$SKU.jpg")"
chk "media Range 206" "206" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=0-99' "$BASE/static/media/$SKU.jpg")"
chk "media Range 416" "416" "$(curl -s -o /dev/null -w '%{http_code}' -H 'Range: bytes=99999999-' "$BASE/static/media/$SKU.jpg")"
chk "media 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/static/media/nope.jpg")"
chk "media 穿越 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' --path-as-is "$BASE/static/../etc/passwd")"

# ---- 目录 API ----
chk "products count=140" "140" "$(curl -s "$BASE/api/products/?limit=5" | jget 'd["count"]')"
chk "products 分页 5" "5" "$(curl -s "$BASE/api/products/?limit=5&skip=5" | jget 'len(d["results"])')"
chk "categories" "3" "$(curl -s "$BASE/api/categories/" | jget 'len(d["categories"])')"
chk "search q=c >5" "true" "$(curl -s "$BASE/api/products/search?q=c" | jget 'str(len(d["results"])>5).lower()')"
SLUG=$(curl -s "$BASE/api/products/?limit=1" | jget 'd["results"][0]["slug"]')
chk "product detail 200" "true" "$(curl -s "$BASE/api/products/$SLUG" | jget 'str(d.get("id") is not None).lower()')"
chk "product 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/products/does-not-exist")"

# ---- 认证 ----
chk "login 401 错口令" "401" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"nope"}' "$BASE/auth/login")"
CK=$(mktemp)
LOGIN=$(curl -s -c "$CK" -X POST -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin123456"}' "$BASE/auth/login")
chk "login 200 token" "true" "$(echo "$LOGIN" | jget 'str(bool(d.get("access_token"))).lower()')"
chk "/auth/me" "admin" "$(curl -s -b "$CK" "$BASE/auth/me" | jget 'd["username"]')"

# ---- 购物篮（先清空，保证断言确定性）----
for pid in $(curl -s -b "$CK" "$BASE/api/basket/" | python3 -c 'import sys,json;d=json.load(sys.stdin);print("\n".join(str(i["product_id"]) for i in d["items"]))' 2>/dev/null); do
  curl -s -b "$CK" -X DELETE "$BASE/api/basket/$pid" > /dev/null
done
sleep 0.3
P1=$(curl -s "$BASE/api/products/?limit=1" | jget 'd["results"][0]["id"]')
chk "guest basket 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/basket/")"
AFILE=$(mktemp)
curl -s -o "$AFILE" -b "$CK" -X POST -H 'Content-Type: application/json' -d "{\"product_id\":$P1,\"quantity\":2}" "$BASE/api/basket/" > /dev/null
chk "basket add" "2" "$(cat "$AFILE" | jget 'd["quantity_in_basket"]')"
chk "basket item product_id" "$P1" "$(curl -s -b "$CK" "$BASE/api/basket/" | jget 'str(d["items"][0]["product_id"])')"
rm -f "$AFILE"
chk "basket patch" "3" "$(curl -s -b "$CK" -X PATCH -H 'Content-Type: application/json' -d '{"quantity":3}' "$BASE/api/basket/$P1" | jget 'd["quantity_in_basket"]')"
chk "basket total" "3" "$(curl -s -b "$CK" "$BASE/api/basket/" | jget 'd["item_count"]')"

# ---- PayPal 下单链路（可选：真实调 sandbox）----
if [ "$WITH_PAYPAL" = "yes" ]; then
  KEY="smoke$(date +%s)"
  CF=$(mktemp)
  CREATE=$(curl -s -o "$CF" -b "$CK" -X POST -H 'Content-Type: application/json' \
    -d "{\"key\":\"$KEY\",\"return_url\":\"$BASE/#/checkout/done?key=$KEY\",\"cancel_url\":\"$BASE/#/basket\"}" \
    "$BASE/api/orders/")
  echo "$CREATE" | head -c 160; echo
  chk "paypal create 201" "true" "$(cat "$CF" | jget 'str(len(d.get("approve_url",""))>0).lower()')"
  ORDER_ID=$(cat "$CF" | jget 'd["order_id"]')
  chk "order_no 带 key 幂等键" "yes" "$(cat "$CF" | grep -q "$KEY" && echo yes || echo no)"
  # 未 approve 就 capture：应被幂等守卫拒绝（ORDER_NOT_APPROVED → 502），订单转 failed，不重复扣款
  CAP_CODE=$(curl -s -o /tmp/cap.out -w '%{http_code}' -b "$CK" "$BASE/api/orders/$ORDER_ID/complete")
  chk "unapproved capture 拒绝 502" "502" "$CAP_CODE"
  chk "capture 后订单 failed" "failed" "$(curl -s -b "$CK" "$BASE/api/orders/$ORDER_ID" | jget 'd.get("status")')"
  # 新订单走取消路径：pending → canceled（幂等可重复调用）
  KEY2="smoke2$(date +%s)"
  C2=$(mktemp)
  CREATE2=$(curl -s -o "$C2" -b "$CK" -X POST -H 'Content-Type: application/json' \
    -d "{\"key\":\"$KEY2\",\"return_url\":\"$BASE/#/checkout/done?key=$KEY2\",\"cancel_url\":\"$BASE/#/basket\"}" \
    "$BASE/api/orders/")
  ORDER2=$(cat "$C2" | jget 'd["order_id"]')
  # 同一用户再发起新 key：旧 pending 应自动 canceled，新订单 order_no 带新 key
  KEY3="smoke3$(date +%s)"
  C3=$(mktemp)
  CREATE3=$(curl -s -o "$C3" -b "$CK" -X POST -H 'Content-Type: application/json' \
    -d "{\"key\":\"$KEY3\",\"return_url\":\"$BASE/#/checkout/done?key=$KEY3\",\"cancel_url\":\"$BASE/#/basket\"}" \
    "$BASE/api/orders/")
  ORDER3=$(cat "$C3" | jget 'd["order_id"]')
  chk "order_no 带新 key" "yes" "$(cat "$C3" | grep -q "$KEY3" && echo yes || echo no)"
  chk "旧 pending 自动取消" "canceled" "$(curl -s -b "$CK" "$BASE/api/orders/$ORDER2" | jget 'd.get("status")')"
  chk "cancel pending" "canceled" "$(curl -s -b "$CK" -X POST "$BASE/api/orders/$ORDER3/cancel" | jget 'd.get("status")')"
  chk "cancel 幂等 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -b "$CK" -X POST "$BASE/api/orders/$ORDER3/cancel")"
  rm -f "$CF" "$C2" "$C3"
fi

# ---- 管理后台（可选：admin 门禁 + 订单/商品管理 + 退款契约）----
# DB 无关写法：
#   本地：   SMOKE_DB_CMD="sqlite3 .data/app.db" SMOKE_USER_CMD="$LUME scripts/create-user.lume"
#   容器：   SMOKE_DB_CMD="docker compose exec -T web sqlite3 /app/.data/app.db"
#            SMOKE_USER_CMD="docker compose exec -T web /usr/local/bin/lume scripts/create-user.lume"
#   SMOKE_DB_CMD 为空则跳过 DB 层退款契约（只验 API 层门禁/订单/商品）
if [ "$WITH_ADMIN" = "yes" ]; then
  SMOKE_DB_CMD="${SMOKE_DB_CMD:-sqlite3 .data/app.db}"
  SMOKE_USER_CMD="${SMOKE_USER_CMD:-$LUME scripts/create-user.lume}"

  # 1) 门禁：guest 401
  chk "admin guest 401" "401" "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/admin/stats")"

  # 2) 门禁：customer 角色 403（临时建一个 customer；经 SMOKE_USER_CMD 建）
  if [ -n "$SMOKE_USER_CMD" ]; then
    $SMOKE_USER_CMD smokecust "smokepass1" customer > /dev/null 2>&1 || true
    CCK=$(mktemp)
    curl -s -c "$CCK" -X POST -H 'Content-Type: application/json' -d '{"username":"smokecust","password":"smokepass1"}' "$BASE/auth/login" > /dev/null
    chk "admin customer 403" "403" "$(curl -s -o /dev/null -w '%{http_code}' -b "$CCK" "$BASE/api/admin/stats")"
    rm -f "$CCK"
  fi

  # 3) stats
  chk "admin stats 200" "true" "$(curl -s -b "$CK" "$BASE/api/admin/stats" | jget 'str(d.get("products_visible",0)>=1).lower()')"
  # 4) orders 列表（含 username 字段）
  chk "admin orders list 200" "true" "$(curl -s -b "$CK" "$BASE/api/admin/orders" | jget 'str(isinstance(d.get("orders"), list)).lower()')"
  chk "admin orders filter 200" "200" "$(curl -s -o /dev/null -w '%{http_code}' -b "$CK" "$BASE/api/admin/orders/?status=pending")"
  chk "admin orders 含 username 字段" "true" "$(curl -s -b "$CK" "$BASE/api/admin/orders" | jget 'str((d.get("orders") and "username" in d["orders"][0]) or (not d.get("orders"))).lower()')"
  # 5) orders by-id 404（不存在的）
  chk "admin orders 404" "404" "$(curl -s -o /dev/null -w '%{http_code}' -b "$CK" "$BASE/api/admin/orders/999999")"
  # 6) 商品上下架 PATCH
  P1ID=$(curl -s "$BASE/api/products/?limit=1" | jget 'd["results"][0]["id"]')
  ORIG=$(curl -s -b "$CK" -X PATCH -H 'Content-Type: application/json' -d '{}' "$BASE/api/admin/products/$P1ID")
  chk "admin product patch 200" "true" "$(echo "$ORIG" | jget 'str(d.get("id")==int("'$P1ID'")).lower()')"
  chk "admin product unpublish" "false" "$(curl -s -b "$CK" -X PATCH -H 'Content-Type: application/json' -d '{"displayable":0}' "$BASE/api/admin/products/$P1ID" | jget 'str(bool(d["displayable"])).lower()')"
  chk "admin product republish" "true" "$(curl -s -b "$CK" -X PATCH -H 'Content-Type: application/json' -d '{"displayable":1}' "$BASE/api/admin/products/$P1ID" | jget 'str(bool(d["displayable"])).lower()')"
  chk "admin product stock" "7" "$(curl -s -b "$CK" -X PATCH -H 'Content-Type: application/json' -d '{"stock":7}' "$BASE/api/admin/products/$P1ID" | jget 'd["stock"]')"
  # 恢复库存
  curl -s -b "$CK" -X PATCH -H 'Content-Type: application/json' -d '{"stock":0}' "$BASE/api/admin/products/$P1ID" > /dev/null

  # 7) 退款契约（经 SMOKE_DB_CMD 造 paid 订单；无 capture → 400；幂等 refunded → 200）
  if [ -n "$SMOKE_DB_CMD" ]; then
    PAID_PROBE="smoke_paid_$(date +%s)"
    TS=$(date +%s)
    dbx "INSERT INTO orders (order_no, user_id, status, total_cents, currency, item_count, items_json, created_at) VALUES ('$PAID_PROBE', 1, 'paid', 500, 'USD', 1, '[]', $TS);"
    OID=$(dbx "SELECT id FROM orders WHERE order_no='$PAID_PROBE';")
    chk "refund 无 capture 400" "400" "$(curl -s -o /dev/null -w '%{http_code}' -b "$CK" -X POST "$BASE/api/admin/orders/$OID/refund")"
    # 造一条带假 capture_id 的：真调 PayPal 会失败（非 200），断言接口 5xx 不炸
    dbx "UPDATE orders SET paypal_capture_id='DUMMYCAPTURE' WHERE id=$OID;"
    RF_CODE=$(curl -s -o /tmp/refund.out -w '%{http_code}' -b "$CK" -X POST "$BASE/api/admin/orders/$OID/refund")
    chk "refund 假 capture 真调非 200" "true" "$([ "$RF_CODE" != "200" ] && echo true || echo false)"
    # 幂等：置为 refunded 后重复退款 → 200 already
    dbx "UPDATE orders SET status='refunded' WHERE id=$OID;"
    chk "refund 幂等 already" "refunded" "$(curl -s -b "$CK" -X POST "$BASE/api/admin/orders/$OID/refund" | jget 'd.get("status")')"
    # 清理造的数据
    dbx "DELETE FROM orders WHERE order_no='$PAID_PROBE';"
    # 清 customer
    dbx "DELETE FROM users WHERE username='smokecust';"
  fi
fi

# ---- 收尾：清篮，保持演示库干净 ----
curl -s -b "$CK" -X DELETE "$BASE/api/basket/$P1" > /dev/null
rm -f "$CK"
echo "=== PASS=$pass FAIL=$fail (paypal=$WITH_PAYPAL) ==="
[ "$fail" -eq 0 ]
