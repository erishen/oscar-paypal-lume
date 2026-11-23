# oscar-paypal-lume —— 容器化运行（lume host + agent-httpd + 本应用）
#
# 构建上下文不是本目录，而是由 `make docker-context` 生成的单一上下文
# （lume host + agent-httpd 子模块 + 本应用），因为 Linux 侧必须重新编译
# lume（宿主机那份是 Mach-O，进不了 Linux 容器）。
#
# 一个 context 只 COPY 一次：OrbStack/buildkit 对同一 context 的并发读有
# checksum 竞态，跨 stage 的 COPY --from 不受影响。

# ---------- 构建期：Linux 工具链编 lume ----------
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential pkg-config libsqlite3-dev libssl-dev ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY . /src
RUN make -C lume/agent-httpd lib \
 && make -C lume all \
 && strip lume/bin/lume \
 && /src/lume/bin/lume --version

# ---------- 运行期 ----------
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
        libsqlite3-0 libssl3 sqlite3 openssl ca-certificates curl tini \
    && rm -rf /var/lib/apt/lists/* \
    && useradd -u 10001 -m -s /usr/sbin/nologin lume

ENV LUME_BIN=/usr/local/bin/lume \
    APP_DIR=/app \
    DATA_DIR=/app/.data \
    PORT=18101 \
    WORKERS=2 \
    BIND=0.0.0.0 \
    LUME_DB=/app/.data/app.db

COPY --from=build /src/lume/bin/lume /usr/local/bin/lume
WORKDIR /app
COPY app/ /app/
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh \
 && mkdir -p "$DATA_DIR" /app/logs \
 && chown -R lume:lume /app
USER lume
EXPOSE 18101
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null || exit 1
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
