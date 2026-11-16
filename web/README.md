# CrushLens Web —— 心动镜·情感追踪（浏览器重制版）

对原版 [CrushLens](https://github.com/Him-Wang/CrushLens)（C# WinForms 桌面程序）的另写实现：
纯前端，无构建、无后端，打开就能用。保留了原版「本地优先、数据不出本机」的取向，
补上了移动端可用性、增量导入与权限审计。

> **和 `legacy/index.html`（旧版 v1.3 单文件网页版）是两套独立实现**，互不影响：
> 那份是旧的官方单文件网页版（自己填 API Key，模型给分）；本目录这份是重制版，分数全在本地算，功能集更偏「长期追踪 + 多人监管」。
> 线上入口是**本目录**（GitHub Actions 把 `web/` 发布到站点根），旧版在 `/legacy/index.html` 仅作留存。
>
> 发布方式：`.github/workflows/pages.yml` 在 `main` 上 `web/**` 变更时先跑语法检查与 `tests/` 单元测试，再发布本目录；Pages 的 source 需为 **GitHub Actions**。本目录里的 `.nojekyll` 是为万一回退到分支发布时不被 Jekyll 过滤掉 `_` 开头的文件。

## ✨ 功能总览

### 用户端（`index.html`）
- **情感浓度追踪**：逐日 0–100 打分曲线、7 日均线、转折点自动标记，支持 14/30/90 天区间
- **复盘与预测**：复盘卡片（峰值日 / 低谷日 / 升温降温 / 风险信号）；未来 7 天预测含置信区间
- **六维分析**：主动、回应、关心、开放、亲密、行动（雷达图）
- **多平台导入**：微信（电脑版导出 & 手机合并转发）、QQ、钉钉、WhatsApp、通用 JSON；粘贴或拖文件均可
- **截图识别导入**：聊天截图本地 OCR，自动判断左右气泡归属、提取内容与日期；图片不上传
- **直连本机**：配合 `assistant/` 的连接助手，按人名聚合本机聊天记录文件、一键导入、20 秒自动同步
- **追踪对象分组**：按对象保存，增量导入按指纹自动去重
- **实时监测 / 使用记录**：增量粘贴即时重算、导入流水与报告快照

### 开发端（`admin.html`）
- 首个认领的账号成为**本机唯一**的总开发者
- 查看**本机浏览器内**各账号的使用次数、导入来源平台、时段分布
- 聊天内容调阅仅对总开发者开放；他人需申请限时授权，到期自动失效
- 审计日志只增不删

> ⚠️ 说明：当前版本没有服务端，监管台的数据源就是**当前浏览器的 IndexedDB**。
> 换设备 / 换浏览器看到的是另一份独立数据。要做真正的跨设备监管必须接后端。

## 🚀 快速开始

```bash
cd web
python -m http.server 8080
# 打开 http://localhost:8080
```

- 用户端：`http://localhost:8080`
- 开发端：`http://localhost:8080/admin.html`

> 必须用 `http://localhost` 或 `https` 打开。直接双击 html（`file://`）时浏览器不提供
> WebCrypto，注册会被明确拒绝——我们宁可拒绝，也不用弱哈希凑合，否则换环境就登不进自己的账号。

### 直连本机（Windows）

1. 打开网页 →「直连本机」→ 下载 `assistant/启动助手.bat` 和 `assistant/连接助手.ps1`（放同一文件夹）
2. 双击 `启动助手.bat`，窗口里会出现一行 6 位**配对码**
3. 回网页输入配对码 → 连上；浏览器问「允许访问本地网络」时点允许

## 🔒 安全模型

连接助手是本项目唯一会接触本机文件的部分，v2 起按下面的模型加固：

| 风险 | 处理 |
|---|---|
| 任意网页通过 `fetch('127.0.0.1:17321')` 读本机聊天 | 启动时生成随机 Token，所有 `/api/*` 校验 `X-Bridge-Token`；网页需先用 6 位配对码换 Token |
| CORS 全开导致浏览器成为攻击跳板 | 精确 Origin 白名单（本应用域名 + localhost），非白名单一律 403；`Allow-Private-Network` 只对白名单返回 |
| 联系人接口泄露本机绝对路径 | 对外只给不可逆的短 id，路径留在助手的映射表里 |
| 被恶意网页一键关掉助手 | `/api/shutdown`、`/api/open-inbox` 改 POST + Token |
| 默认翻遍桌面 / 下载目录 | 默认只扫投递箱；扩大范围需显式用 `-ScanUserFolders` 启动 |
| 路径前缀绕过（`DownloadsEvil/`） | 目录匹配补分隔符边界 |

配对码连续输错 5 次锁定 1 分钟；助手重启即换新码，旧 Token 自动失效。

## 🧪 测试

```bash
cd web
node tests/engine.test.js      # 引擎白盒：daily 完整性、伪转折、多格式解析、样本门槛
```

## 📁 目录结构

```
web/
├── index.html          # 用户端
├── admin.html          # 开发端
├── assets/
│   ├── engine.js       # 解析器 + 浓度/趋势/预测引擎（纯函数，可单测）
│   ├── store.js        # IndexedDB 存储 + 账号/权限/审计
│   ├── ocr.js          # 截图识别（tesseract.js 自托管，无 CDN 回退）
│   ├── ui.js           # 图表 / 图标 / 弹窗
│   ├── app.js          # 用户端逻辑
│   ├── admin.js        # 监管台逻辑
│   ├── style.css       # 样式系统
│   ├── vendor/         # tesseract.js + wasm 内核 + 第三方许可证（见 NOTICE.md）
│   └── tessdata/       # 中文 OCR 语言包（20MB，随仓库分发）
├── assistant/          # Windows 连接助手（PowerShell，零依赖）
└── tests/              # 引擎白盒测试
```

## 🔒 隐私

- 所有分析在浏览器本地完成，聊天记录不上传任何服务器
- OCR 完全本地执行，引擎与语言包随站点自托管，**没有 CDN 回退**
- 连接助手只读文件、只绑 `127.0.0.1`、不联网、不写注册表

## 第三方组件

`assets/vendor/` 与 `assets/tessdata/` 下的文件属于第三方（tesseract.js / tesseract.js-core / tessdata，
均为 Apache-2.0），来源与许可证原文见 [`assets/vendor/NOTICE.md`](assets/vendor/NOTICE.md)。
项目自身代码沿用仓库根目录的 MIT 许可证。
