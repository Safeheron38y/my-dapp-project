# 部署指南（免费托管：前端 + 后端同一个 Node 服务）

> 状态：**仅做了部署准备，尚未部署。** 本项目零依赖（无 `npm install`），一个 Node 20 进程同时提供静态前端（`public/`）和 API（`/api/*`、`/provider/*`、`/admin`）。
> 全部数据为**演示币 / 示例数据**，不涉及真实资金。

## 1. 推荐方案：Render 免费 Web 服务（Docker）

仓库根目录已提供：

| 文件 | 作用 |
|---|---|
| `Dockerfile` | `node:20-alpine`，非 root 运行，只拷贝 `server/` 与 `public/`，带 `HEALTHCHECK` |
| `render.yaml` | Render Blueprint：免费实例、`healthCheckPath: /api/health`、环境变量 |
| `.dockerignore` | 排除 `.git` / `shots` / `docs` / `data` 等 |
| `package.json` | `npm start` = `node server/index.js`（用 Node 运行时部署时用得到） |

### 步骤
1. 把本仓库推到 GitHub（私有仓库也可以，Render 授权访问即可）。
2. Render 控制台 → **New → Blueprint** → 选择该仓库 → 它会读取 `render.yaml` 创建 `8k-platform`（Free）。
   - 或者 **New → Web Service**：Runtime 选 *Docker*（用根目录 Dockerfile），Instance Type 选 *Free*，Health Check Path 填 `/api/health`，再按下表加环境变量。
3. 部署完成后访问：
   - 前台：`https://<服务名>.onrender.com/`（登录 `/login.html`，注册 `/register.html`）
   - 后台：`https://<服务名>.onrender.com/admin`
   - 健康检查：`https://<服务名>.onrender.com/api/health`
4. **管理员密码**：`render.yaml` 里 `ADMIN_PASSWORD` 使用 `generateValue: true`，由 Render 随机生成；在服务的 **Environment** 页查看（或改成自己的值）。**不要把演示默认密码 `Admin@2026!` 暴露在公网。**

> 不想用 Docker？也可以建 *Node* 运行时的 Web Service：Build Command 留空（或 `echo ok`），Start Command `node server/index.js`，其余环境变量相同。

### 环境变量

| 变量 | 默认 / 建议 | 说明 |
|---|---|---|
| `PORT` | Render 自动注入（10000） | 服务读取 `PORT`，监听 `0.0.0.0` |
| `TRUST_PROXY` | `1` | 在 Render 反向代理后按 `X-Forwarded-For` 取真实 IP。**不设则所有人共用代理 IP**，登录限流/锁定会互相影响 |
| `DATA_DIR` | `/app/data` | JSON 持久化目录；`off` = 不落盘（纯内存） |
| `HUIDU_SIMULATOR` | `on` | 使用内置 HUIDU 模拟器（默认开启，无需真实凭据） |
| `SIGNATURE_MODE` | `enforce` | 供应商回调签名校验 |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / 随机 | 设置后**每次启动以它们为准**（可用来重置后台密码；`ADMIN_PASSWORD_FORCE=0` 则仅在账号不存在时创建） |
| `DEMO_PLAYER_PASSWORD` | 不设 = `Test@2026` | 演示玩家 `test01/02/03` 的密码；设置后登录页不再显示演示账号提示 |
| `SEED_DEMO` | 不设 | `0` = 不创建演示玩家 |
| `DEMO_PLAYERS` / `DEMO_PLAYER_BALANCE` | `test01,test02,test03` / `10000` | 演示玩家名单与初始演示币 |
| `PUBLIC_BASE_URL` | 可不设 | 不设时按 `Host` / `X-Forwarded-Proto` 推断 |
| `HUIDU_MODE` | 不设 = 模拟器 | `live` = 连接真实 HUIDU（Staging/生产）；`sim` = 模拟器。**优先于 `HUIDU_SIMULATOR`**。详见 §6 |
| `HUIDU_SERVER_URL` / `HUIDU_AGENCY_UID` / `HUIDU_AES_KEY` / `HUIDU_PLAYER_PREFIX` | 空 | 仅 `HUIDU_MODE=live` 时需要（在 Render Environment 里填，**切勿提交到仓库**）。详见 §6 |
| `LOGIN_RATE_LIMIT_PER_MIN` / `ADMIN_LOGIN_RATE_LIMIT` | `30` / `10(每5分钟)` | 登录限流（按 IP） |

## 2. 免费档的限制（务必知晓）

以下依据 Render 官方文档（<https://render.com/docs/free>，2026 年）：

- **闲置休眠**：15 分钟没有入站 HTTP 请求（或 WebSocket 消息）就会休眠；下一次请求触发**冷启动，约 1 分钟**，期间浏览器会看到 Render 的加载页。演示前可以先手动访问一次 `/api/health` 预热。
- **临时磁盘（ephemeral）**：每次**重启 / 休眠 / 重新部署**后本地文件全部丢失 —— 也就是 `DATA_DIR` 里的玩家、余额、账本、后台设置会**重置回初始状态**（重新种子：`test01~03`、`admin`）。内存里的登录会话同样丢失（重启后需重新登录）。持久磁盘（Persistent Disk）**只有付费实例才有**。
- **每月 750 免费实例小时**（按工作区计）：超出后免费服务会被暂停到下月；休眠期间不消耗小时。
- 免费实例只能**单实例**运行（不能横向扩容），资源很小（约 0.1 vCPU / 512MB，以官方为准）：**scrypt 密码哈希在低 CPU 上会慢一些（百毫秒级）**，属正常。Render 也可能随时重启免费服务。
- 免费 Postgres 30 天后过期，且本项目目前未使用数据库。
- 其它：无 SSH/Shell、不能跑一次性 Job、无边缘缓存。

### 想要数据真正持久怎么办？
1. 升级为付费实例并挂载 **Persistent Disk**，把 `DATA_DIR` 指向挂载路径（例如 `/var/data`）；
2. 或把 `lib/store.js` / `lib/persist.js` 换成数据库（Postgres 等，见 `API.md` §14 的生产化待办）；
3. 或接受“演示环境每次醒来都是初始数据”（最省事，适合展示）。

### 防休眠（可选，仅演示）
可用外部定时器（如 UptimeRobot、cron-job.org）每 10 分钟请求一次 `/api/health`。注意：这会持续占用 750 小时额度（一个服务 24×31=744 小时，刚好不超；多个免费服务共用额度会超）。

## 3. 其它免费/低成本选项（简述）
- **Fly.io / Railway / Koyeb 等**：同样可用本 Dockerfile，免费额度和政策各家不同且变化较快，请以官网为准。
- **纯静态托管（Vercel/Netlify/GitHub Pages）只能放前端**，不能运行本 Node 后端；前端可通过 `window.__8K_API_BASE__` 指向另一处部署的 API（需配置 `ALLOWED_ORIGINS` 做 CORS，且后台 Cookie 为 `SameSite=Strict`，跨域部署后台不可用，**建议前后端同域部署**）。

## 4. 上线前检查清单（演示 → 对外）
- [ ] 修改/随机化 `ADMIN_PASSWORD`；`DEMO_PLAYER_PASSWORD` 或 `SEED_DEMO=0`（不要把演示账号公开）
- [ ] `TRUST_PROXY=1`，确认限流按真实 IP 生效
- [ ] `/admin` 建议再加一层网关保护（IP 白名单 / Basic Auth / Cloudflare Access）
- [ ] 持久化方案（付费磁盘或数据库），并做备份
- [ ] 真实供应商凭据只放在环境变量里；`SIGNATURE_MODE=enforce`；配置供应商回调 IP 白名单
- [ ] 合规：KYC/年龄核验/地区限制/负责任博彩 —— 当前均为演示桩
- [ ] 邮箱/手机验证、找回密码、2FA（玩家与管理员）尚未实现

## 5. 本地用 Docker 验证（可选）
```bash
docker build -t 8k-platform .
docker run --rm -p 10000:10000 -e ADMIN_PASSWORD='换成你的密码' 8k-platform
# 浏览器打开 http://localhost:10000  与  http://localhost:10000/admin
```

## 6. 接入真实 HUIDU（Staging / 生产）

> ⚠ 仓库是公开的：**真实 `agency_uid` / `aes_key` 只能放在 Render Dashboard → Environment（或本地未提交的 `.env.local`）**，不得写进任何被提交的文件、日志、测试、README。下面全部是占位符。

### 6.1 需要在 Render 设置的环境变量（由你在 Dashboard 里填，Grok/代码不会去动 Dashboard）

| 变量 | 值（占位符） | 说明 |
|---|---|---|
| `HUIDU_MODE` | `live` | 切到真实 HUIDU；不设/`sim` 则仍是模拟器 |
| `HUIDU_SERVER_URL` | `<HUIDU 提供的 server_url，例如 https://…>` | 别名 `HUIDU_BASE_URL`（两者都设时以 `HUIDU_BASE_URL` 为准） |
| `HUIDU_AGENCY_UID` | `<HUIDU 提供的 agency_uid，32 位>` | 每个请求里明文出现，不算机密，但也不要入库 |
| `HUIDU_AES_KEY` | `<HUIDU 提供的 aes_key，恰好 32 个 ASCII 字符>` | **机密**（AES-256-ECB 密钥，同时用于校验回调） |
| `HUIDU_PLAYER_PREFIX` | `<HUIDU 提供的 player_prefix，例如 h12345>` | 别名 `HUIDU_ALIAS_PREFIX`；见 §6.3 |
| `HUIDU_CURRENCY` | `USD`（默认） | 玩家币种。**HUIDU 一旦为某玩家定下币种就不能改（10011）**，请先和 HUIDU 确认 |
| `HUIDU_WALLET_MODE` | `shared`（默认） | 代理账号是共享钱包(seamless)还是转账钱包(transfer)取决于 HUIDU 开通哪种；用错返回 10024 |
| `PUBLIC_BASE_URL` | `https://eightk-platform.onrender.com` | 建议显式设置：启动游戏时作为 `callback_url` 与 `home_url` 的基础 |
| `HUIDU_SIMULATOR` | **删除**（或设 `off`） | `render.yaml` 默认带 `on`；`HUIDU_MODE=live` 会覆盖它，但删掉更清晰 |
| `HUIDU_CALLBACK_URL` | 可选，`https://<你的域名>/provider/huidu_seamless/callback` | 覆盖发给 HUIDU 的 `callback_url`（默认 = `PUBLIC_BASE_URL` + 回调路径） |
| `HUIDU_CALLBACK_IPS` | 可选，`<HUIDU 回调出口 IP,逗号分隔>` | 设置后只接受这些来源 IP 的回调（需 `TRUST_PROXY=1`）；不知道 IP 就不要设，否则会把真实回调拦掉 |
| `HUIDU_TS_TOLERANCE_SEC` | 可选，默认 `86400` | 回调时间戳容差，`0` = 不校验 |

设置后重新部署，访问 `/api/health`：应出现 `"providerModes":{"huidu_seamless":"live"}`。若显示 `misconfigured`，说明上面某个变量缺失/AES 密钥不是 32 字符（不会静默回退到模拟器）。

### 6.2 回调（seamless 共享钱包）
- 回调地址（HUIDU 只有这一个）：`POST https://eightk-platform.onrender.com/provider/huidu_seamless/callback`。
- 请求/响应均为 `{agency_uid,timestamp,payload}` + AES-256-ECB；HTTP 恒 200；成功 `code:0`，失败 `code:1`；**无论成功失败都在加密 `payload` 里返回 `credit_amount`（余额）**；`serial_number` 幂等。
- 需向 HUIDU 登记：① 上述回调 URL；② 如果 HUIDU 对 API 来源做 IP 白名单，要登记 Render 服务的**出站 IP**（Dashboard → 服务 → *Connect → Outbound*）；③ 如果 HUIDU 的回调有固定出口 IP，可让他们告知并填入 `HUIDU_CALLBACK_IPS`。
- 自测（对本地或已部署服务发送加密样例回调；默认 bet=0/win=0 只查余额）：
  `node server/scripts/huidu-callback-test.js https://eightk-platform.onrender.com <member_account>`（凭据取自环境变量/`.env.local`）。
- 免费实例会休眠（冷启动约 1 分钟）：休眠期间 HUIDU 的回调可能超时失败，**正式联调/上线请用常驻（付费）实例**。

### 6.3 玩家 ID / 钱包（Player ID / wallet notes）
- **HUIDU 没有单独的“创建/登录玩家”接口**：玩家在第一次调用启动接口 `POST /game/v1`（共享钱包）或 `/game/v2`（转账钱包）时按 `member_account` 自动创建；之后同名即同一玩家。
- `member_account` **必须以 `HUIDU_PLAYER_PREFIX` 开头**，否则 HUIDU 返回 `10022`（`member_account must start with <prefix>`）。本平台映射：`member_account = <PLAYER_PREFIX> + sha256("huidu_seamless|<内部 user.id>") 的前 (20 − 前缀长度) 位十六进制`（总长 20、仅 `a-z0-9`、稳定、不可从别名反推内部 ID）。前缀最长 10 位；过长会挤占随机部分。
- 别名是**确定性**的：进程重启/免费实例休眠后内存映射丢失，收到回调时会按前缀惰性重建，无需持久化。但免费实例重启会重置玩家库（新 `user.id` ⇒ 新别名 ⇒ HUIDU 侧是新玩家，旧玩家余额不再对应）。**生产必须持久化用户库与别名。**
- 币种：玩家首次启动时确定（`HUIDU_CURRENCY`，默认 USD），之后固定（`10011`）。
- 共享钱包：平台账本是唯一余额来源。启动游戏时把当前余额作为 `credit_amount` 传给 HUIDU；之后每笔下注/派彩通过回调结算：`新余额 = 旧余额 − bet_amount + win_amount`（负数 = 退款）。
- 转账钱包（若 HUIDU 给的是 transfer 型代理）：设 `HUIDU_WALLET_MODE=transfer`；启动前自动按 `HUIDU_AUTO_TRANSFER`（`all`/`none`/金额）转入，余额查询用 `credit_amount=0`。一个代理只能用一种模式（用错 `10024`）。
- 本地联调：把同名变量写进 `.env.local`（已在 `.gitignore`，且 `.dockerignore` 排除，不会进镜像或仓库），`node server/index.js` 会自动读取；真实环境变量优先于文件。测试 (`npm test`) 强制使用模拟器，不读取 `.env.local`。
- 只读连通性检查（不花钱）：`HUIDU_MODE=live node server/scripts/huidu-live-check.js`。
