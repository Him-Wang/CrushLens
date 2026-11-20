# CrushLens Cloud Worker

零成本后端：Cloudflare Workers (Free) + D1 (Free) + Brevo (Free 300 封/天)。
只存**账号元数据**，聊天内容永不上传（见 `schema.sql` 注释）。

## 为什么需要它（硬事实）

浏览器直接 `POST https://github.com/login/device/code` / `POST /login/oauth/access_token`
带 `Origin` 会返回 **404 且无 CORS 头**，`OPTIONS` 同样 404。所以 GitHub 登录必须
有一个服务端中转。本 Worker 就是那个中转，同时承载邮箱注册/登录。

## 一次性部署

```bash
cd worker
npm i -g wrangler        # 仅部署工具，站点本身零构建、零运行时依赖
wrangler login

# 1) 建 D1 数据库，把 id 填进 wrangler.toml 的 database_id
wrangler d1 create crushlens
wrangler d1 execute crushlens --remote --file=./schema.sql

# 2) 写密钥（永远不要提交到仓库）
wrangler secret put GH_CLIENT_ID       # GitHub OAuth App 的 Client ID
wrangler secret put GH_CLIENT_SECRET   # GitHub OAuth App 的 Client secret
- `BREVO_KEY` 是**必需**的：未配置时邮箱注册/密码找回返回 503 且不发码（绝不把验证码回传前端——那会让任何人重置他人密码）。GitHub 登录不依赖 Brevo。

wrangler secret put PEPPER             # 随机长串：openssl rand -hex 32
wrangler secret put OWNER_EMAIL        # 总开发者邮箱（/admin/accounts 仅此邮箱可读）

# 3) 发布
wrangler deploy
# 记下输出的 https://crushlens-api.<你的子域>.workers.dev
```

## GitHub OAuth App 配置

- Settings → Developer settings → OAuth Apps → New OAuth App
- **Authorization callback URL**: `https://him-wang.github.io/?gh=1`
- 拿到 Client ID / Client secret 填进上面的 secret。
- 站点侧在「设置 → 云端接口地址」填入 Worker 域名即可（存 localStorage，不入库）。

## 端点

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | `/gh/login` | 302 到 GitHub 授权页 |
| GET | `/gh/callback` | code 换 token → 读用户 → 建/复用账号 → 下发会话 |
| POST | `/email/code` | 发验证码（Brevo） |
| GET | `/salt?email=` | 取盐（不存在则给新盐，不泄露账号是否存在以外的信息） |
| POST | `/register` | `{email,code,salt,stretched}` → 建账号 |
| POST | `/login` | `{email,stretched}` → 会话；5 次失败锁 15 分钟 |
| POST | `/logout` | 销毁会话 |
| GET | `/me` | 当前账号元数据 |
| POST | `/password/reset` | 邮箱验证码重置密码 |
| GET | `/admin/accounts` | 仅 OWNER_EMAIL，账号元数据列表 |
| POST | `/account/sync-counts` | 上报追踪对象数量（仅计数） |

## 密码处理（重要）

Workers Free 每请求只有 10ms CPU，服务端跑 10 万次 PBKDF2 会触发 `Error 1102`。
因此：浏览器 `crypto.subtle` 做 `PBKDF2-SHA256(password, salt, 100000)` → `stretched`，
Worker 只做一次 `HMAC-SHA256(pepper, stretched+salt)` 存库。`stretched` 等价于密码，
所以**必须 HTTPS**；Worker 只接受 `https://him-wang.github.io` 与 `http://localhost:*` 来源。

## 配额降级

Brevo 免费额度用尽时 `/email/code` 返回非 2xx，前端显示明确文案，绝不白屏。D1 额度极难触顶（5GB / 500 万行读/天）。
