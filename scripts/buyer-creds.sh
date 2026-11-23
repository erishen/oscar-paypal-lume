#!/bin/sh
# buyer-creds.sh —— 从本机 Chrome Keychain 临时解密一个 PayPal sandbox buyer 账号。
#
# 用法（不要直接执行，要 source，凭据才会进当前 shell 环境）：
#   eval "$(scripts/buyer-creds.sh)"     # zsh/bash 都可以
#   E2E_LIVE=1 PAYPAL_LOGIN=1 make test-e2e-live
#
# 说明：
# - 只读取 Chrome 保存的 sb-*@*.example.com 账号，优先 personal（buyer）。
# - 密码用 Chrome Safe Storage 密钥 + PBKDF2 + AES-128-CBC 解密，PKCS7 去 padding。
# - 只向 stdout 输出两行 shell 赋值语句（供 eval/source），不写文件、不打印明文到终端日志以外。
# - 需要 macOS；依赖 security / openssl / python3 / Chrome 已保存过 sandbox 账号。

set -e

python3 - <<'PY'
import subprocess, hashlib, sqlite3, shutil, os, tempfile, sys

def sh_quote(s):
    return "'" + s.replace("'", "'\\''") + "'"

# 1) Chrome Safe Storage 密钥
r = subprocess.run(['security', 'find-generic-password', '-s', 'Chrome Safe Storage', '-w'],
                   capture_output=True)
if r.returncode != 0 or not r.stdout.strip():
    print('# ERROR: 无法从 Keychain 读取 Chrome Safe Storage', file=sys.stderr)
    sys.exit(1)
aes_key = hashlib.pbkdf2_hmac('sha1', r.stdout.strip(), b'saltysalt', 1003, 16)
iv = (' ' * 16).encode()

# 2) 从 Chrome Login Data 找一个 sandbox buyer（personal 优先）
src = os.path.expanduser('~/Library/Application Support/Google/Chrome/Default/Login Data')
if not os.path.exists(src):
    print('# ERROR: 找不到 Chrome Login Data', file=sys.stderr)
    sys.exit(1)
tmp = tempfile.mktemp(suffix='.db')
shutil.copy(src, tmp)
try:
    con = sqlite3.connect(tmp)
    rows = con.execute(
        "SELECT username_value, password_value FROM logins "
        "WHERE username_value LIKE 'sb-%@%.example.com'"
    ).fetchall()
    con.close()
finally:
    os.unlink(tmp)

personal = [x for x in rows if '@personal.example.com' in x[0]]
chosen = (personal or rows)
if not chosen:
    print('# ERROR: Chrome 里没有 PayPal sandbox sb-* 账号', file=sys.stderr)
    sys.exit(1)
user, pv = chosen[0]

# 3) 解密 + PKCS7 去 padding
enc = pv[3:] if pv[:3] in (b'v10', b'v11') else pv
p = subprocess.run(['openssl', 'enc', '-d', '-aes-128-cbc',
                    '-K', aes_key.hex(), '-iv', iv.hex(), '-nopad'],
                   input=enc, capture_output=True)
if p.returncode != 0:
    print('# ERROR: 密码解密失败', file=sys.stderr)
    sys.exit(1)
raw = p.stdout
n = raw[-1]
if 1 <= n <= 16 and raw[-n:] == bytes([n]) * n:
    pwd = raw[:-n]
else:
    pwd = raw.rstrip(b'\x00')
pwd = pwd.decode('utf-8', 'ignore')

# 4) 只输出 shell 赋值（供 eval），凭据不写文件
print('BUYER_EMAIL=' + sh_quote(user))
print('BUYER_PASS=' + sh_quote(pwd))
PY
