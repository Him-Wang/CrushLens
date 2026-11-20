# GitHub 登录 / 云端账号部署指南（零成本）

当前状态：**后端从未部署**，所以登录页的「使用 GitHub 登录」点了没反应是正常的——仓库里 `worker/wrangler.toml` 还是占位符，密钥也都没配。按下面 6 步做完，GitHub 登录、邮箱验证码、云端账号就都能用了。全程零成本（Cloudflare / GitHub OAuth / Brevo 都用免费额度）。

---

## 第 0 步：准备三个免费账号

1. **Cloudflare**（https://dash.cloudflare.com/sign-up）—— 部署 Worker + D1。
2. **GitHub**（你已有）—— 创建一个 OAuth App。
3. **Brevo**（https://www.brevo.com/ ，免费 300 封/天）—— 发注册验证码。

---

## 第 1 步：创建 GitHub OAuth App

1. 打开 https://github.com/settings/developers → **OAuth Apps** → **New OAuth App**。
2. 填写：
   - Application name：`CrushLens`
   - Homepage URL：`https://him-wang.github.io/CrushLens/`
   - **Authorization callback URL**：`https://crushlens-api.<你的子域>.workers.dev/gh/callback`
     （`<你的子域>` 就是第 3 步 wrangler 部署时让你填的 Worker 名字；回调 URL 必须和 Worker 实际地址完全一致， GitHub 会严格匹配。）
3. 创建后记下 **Client ID**，点 **Generate a new client secret** 记下 **Client secret**（只显示一次）。

---

## 第 2 步：准备 Brevo

1. 注册并登录 Brevo → 右上角头像 → **SMTP & API** → **API Keys** → **Generate a new API key**，记下 key。
2. 验证发件人：SMTP & API → **Senders** → 添加一个你自己的邮箱并验证（免费额度必须验证发件人才能发信）。

---

## 第 3 步：部署 Worker + D1

需要先装 Node（你已有 v22）和 wrangler（仅部署工具，站点本身零依赖）：

```bash
npm i -g wrangler
wrangler login          # 浏览器里授权 Cloudflare 账号
```

进入 `worker/` 目录：

```bash
cd worker
```

### 3.1 建 D1 数据库

```bash
wrangler d1 create crushlens
```

命令会输出一个 `database_id`。把它填进 `worker/wrangler.toml` 第 13 行：

```toml
database_id = "这里填刚才的 database_id"
```

### 3.2 初始化表结构

```bash
wrangler d1 execute crushlens --remote --file=schema.sql
```

### 3.3 配置密钥（5 个 secret + 1 个变量）

```bash
wrangler secret put GH_CLIENT_ID      # 第 1 步的 Client ID
wrangler secret put GH_CLIENT_SECRET  # 第 1 步的 Client secret
wrangler secret put BREVO_KEY         # 第 2 步的 Brevo API key
wrangler secret put PEPPER            # 随便一个长随机串，如 openssl rand -hex 32 的结果
wrangler secret put OWNER_EMAIL       # 你的邮箱，/admin/accounts 管理员入口用
```

`SITE_ORIGIN` 是普通变量，`wrangler.toml` 里已写死 `https://him-wang.github.io`，不用动。
`MAIL_FROM` 里 `no-reply@crushlens.workers.dev` 若未验证，改成第 2 步验证过的发件邮箱。

### 3.4 部署

```bash
wrangler deploy
```

记下输出的地址，形如 `https://crushlens-api.<你的子域>.workers.dev`。

---

## 第 4 步：站点侧填 Worker 地址

1. 打开线上站点 https://him-wang.github.io/CrushLens/ 。
2. 点「先不登录，本地用」进入。
3. 设置 → 模型与云端 → **云端接口地址（Worker）** 填第 3.4 步的地址（`https://crushlens-api.<你的子域>.workers.dev`，结尾不要带 `/`），保存。

这个地址只存在你浏览器的 localStorage（`cl_api_base`），不入库、不影响其他访客。**每个想用云端登录的浏览器都要各填一次**——这是当前设计（零后端配置下沉到用户侧）。如果想让所有访客开箱即用，需要把这个默认值写进 `web/assets/api.js` 的 `base()`，那属于产品决策，告诉我我再改。

---

## 第 5 步：GitHub OAuth 回调 URL 对齐

回到第 1 步建的 OAuth App，确认 **Authorization callback URL** 与第 3.4 步的实际 Worker 地址完全一致（含 `/gh/callback`）。不一致就改过来。

---

## 第 6 步：验收

- 登录页点「使用 GitHub 登录」→ 跳到 GitHub 授权 → 同意 → 跳回站点并显示已登录（2 次重定向内）。
- 注册页填邮箱 → 发送验证码 → Brevo 收到信 → 填码注册成功。
- 换一个浏览器打开站点 → 填同样的 Worker 地址 → 登录，看到账号状态但数据为空（正确空态文案）。
- 管理员入口（`/admin.html`）→ 云端账号，能看到账号元数据、看不到任何聊天内容。

---

## 常见问题

- **点了 GitHub 按钮提示「还没有配置云端接口地址」** → 第 4 步没做，或当前浏览器没填 `cl_api_base`。
- **GitHub 报 redirect_uri_mismatch** → 第 5 步回调 URL 没对齐（注意结尾 `/gh/callback`、协议、子域）。
- **验证码发不出去** → 第 2 步 Brevo 发件人没验证，或 `BREVO_KEY` 没配；Worker 未配 key 时会返回 503 并给出明确错误（不会白屏）。
- **登录跳回来仍是未登录** → 浏览器拦截了第三方 Cookie；本站靠 `SameSite=None; Secure` 的会话 Cookie 跨站（github.io ↔ workers.dev）维持登录，需允许第三方 Cookie。
- **Worker 报 Error 1102 超出资源限制** → 不应发生：密码拉伸在浏览器做（10 万次 PBKDF2），Worker 只做一次 HMAC。若出现，检查是不是有人改了 `api.js` 的拉伸逻辑。
