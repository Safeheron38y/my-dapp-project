# 8K 游戏集成层 API 文档

> 状态：**Mock / 演示版**。所有游戏、赔率、赛事、余额、供应商均为占位数据，钱包为内存存储（重启清零）。
> 目标：让前端与业务流程先跑通，之后只需 **新增供应商适配器 + 替换存储**，即可接入真实游戏供应商。
> 机器可读版本见 [`openapi.yaml`](./openapi.yaml)。

## 目录
1. [架构总览](#1-架构总览)
2. [运行与配置](#2-运行与配置)
3. [通用约定](#3-通用约定)
4. [玩家端接口](#4-玩家端接口)
5. [供应商回调（共享钱包）](#5-供应商回调共享钱包)
6. [钱包流程：共享钱包 vs 转账钱包](#6-钱包流程共享钱包-vs-转账钱包)
7. [幂等与冲正规则](#7-幂等与冲正规则)
8. [如何新增一个供应商适配器](#8-如何新增一个供应商适配器)
9. [前端 postMessage 桥](#9-前端-postmessage-桥)
10. [地区开关与限额（默认全开）](#10-地区开关与限额默认全开)
11. [负责任博彩钩子](#11-负责任博彩钩子)
12. [安全注意事项](#12-安全注意事项)
13. [上线前需要您提供的清单](#13-上线前需要您提供的清单)
14. [已知缺口 / 生产化待办](#14-已知缺口--生产化待办)
15. [HUIDU（GameApi）集成](#15-huiduygameapi集成)
16. [大厅与目录（170 款精选 / 捕鱼）](#16-大厅与目录170-款精选--捕鱼)

---

## 1. 架构总览

```
浏览器(前端 public/)                       8K 服务器 (server/)                         游戏供应商
 ├ 大厅 /                ──GET /api/games──▶  config/games.json(目录) ◀── adapter.listGames()(可选)
 ├ /game.html (iframe)   ──POST launch──────▶  adapters/<name>.launch() ───────────────▶ 创建会话/取游戏 URL
 │    ▲ postMessage 桥        ◀─ {url,token}─┘
 │    └ iframe 内供应商游戏 ───────────────────────────────────────────────────────────▶ 供应商服务器
 │                                              ◀── POST /provider/:name/{balance|bet|win|rollback|refund} ──┘
 │                                                   (HMAC 验签 → adapter.parseCallback → lib/wallet.js → 账本)
 ├ 自研 Crash/Plinko/Mines ─POST /api/inhouse/*─▶ lib/inhouse.js ─▶ wallet.bet / wallet.win
 ├ 真人视讯演示窗口      ──POST /api/live/:game/bet─▶ lib/live.js (mock RNG 演示结算)
 └ 体育 /sports.html     ──/api/sports/*────▶ lib/sports.js (mock 赛事/赔率)
```

关键分层：

| 层 | 文件 | 说明 |
|---|---|---|
| 路由/HTTP | `server/index.js`, `lib/http.js` | 零依赖 `http`；静态文件、CORS、CSP、限流、JSON 错误 |
| 钱包核心 | `lib/wallet.js` | 余额(整数分)、幂等、冲正、限额、转账钱包；**所有资金变动只走这里** |
| 适配器 | `adapters/*.js` | 供应商差异(签名、字段、响应格式、启动 URL)全部封装在这里 |
| 配置 | `config/providers.json` / `regions.json` / `games.json` | 供应商、地区开关与限额、游戏目录 |
| 合规钩子 | `lib/rg.js`, `lib/geo.js` | 负责任博彩、地区品类/限额 |

## 2. 运行与配置

```bash
cd /workspace/8k-platform/server
PORT=8088 node index.js           # 前端与 API 同域： http://localhost:8088
node test/run.js                  # 运行集成测试(自带随机端口，不占用 8088)
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` / `HOST` | `8088` / `0.0.0.0` | 监听 |
| `SIGNATURE_MODE` | `enforce` | `enforce` 拒绝验签失败；`log` 只记录；`off` 关闭。**生产必须 `enforce`** |
| `SIGNATURE_TOLERANCE_SEC` | `300` | 时间戳容忍窗口 |
| `ALLOWED_ORIGINS` | 空 | 前端与 API 不同域时，列出允许的 Origin(逗号分隔)；`*` 仅限开发 |
| `PUBLIC_BASE_URL` | 空 | 对外域名，用于生成启动 URL/回调地址（反向代理后必填） |
| `MOCK_ADMIN` | 开 | 设为 `0` 关闭 `/api/mock/*` 与体育模拟结算接口（生产必须关闭） |
| `CONFIG_DIR` / `PUBLIC_DIR` | 默认 | 自定义配置/静态目录 |
| `*_BASE_URL` `*_API_KEY` `*_SECRET` | 占位 | 见 `providers.json`，`${VAR:-默认}` 语法 |

前端若与 API 分开部署：在页面里先定义 `window.__8K_API_BASE__ = 'https://api.example.com'`。

## 3. 通用约定

- **金额**：JSON 中为主币单位的 number，**最多 2 位小数**；服务端内部一律转换为整数「分」，超过 2 位小数、负数、非数字 → `400 INVALID_AMOUNT`。
- **鉴权**：玩家接口 `Authorization: Bearer <token>`（`/api/auth/login` 或 `/api/auth/register` 获得）。供应商回调使用 HMAC 签名，见 §5。
- **地区**：优先使用账户地区；未登录的列表类接口可用 `?region=` 或 `X-Region` 头（⚠ 生产应由网关依据 IP 注入并剥离客户端同名头）。
- **错误格式**（HTTP 状态码 + 统一 JSON）：
  ```json
  { "ok": false, "code": "INSUFFICIENT_FUNDS", "message": "余额不足", "balance": 12.5 }
  ```
  常见 `code`：`UNAUTHORIZED 401` · `INSUFFICIENT_FUNDS 402` · `INVALID_AMOUNT 400` · `ABOVE_MAX_BET / BELOW_MIN_BET 400` · `CATEGORY_DISABLED 403` · `SELF_EXCLUDED / COOL_OFF 403` · `IDEMPOTENCY_CONFLICT 409` · `TX_CANCELLED 409` · `ROUND_CANCELLED 409` · `ODDS_CHANGED 409` · `RATE_LIMITED 429`。
- **客户端幂等**：下注类接口(`/api/inhouse/*`、`/api/live/*/bet`、`/api/sports/bets`、`/api/wallet/deposit|transfer`)支持请求头 `Idempotency-Key: <8-100 位 [\w.:-]>`。同 key + 同载荷 → 返回首次结果（`idempotentReplay: true`，不再扣款）；同 key 不同载荷 → `409`。**网络超时后重试必须复用同一个 key**。

## 4. 玩家端接口

### POST `/api/auth/register` · POST `/api/auth/login`（用户名 + 密码）
密码用 **scrypt**（Node 内置，N=16384,r=8,p=1，随机盐，恒定时间比较）哈希后存储，格式 `scrypt$N$r$p$salt$hash`。不存在的用户名也会做一次等价哈希，错误信息一致（防枚举）。
```http
POST /api/auth/register   { "username": "alice", "password": "Abcd1234" }     # 用户名 2-32 位(字母数字汉字 _ -)；密码 8-64 位，需含字母+数字
POST /api/auth/login      { "username": "alice", "password": "Abcd1234", "region": "default" }
```
```json
{ "token": "tk_…", "expiresIn": 43200, "user": {"id":"u_ab12…","username":"alice","region":"default"},
  "wallet": {"balance":1000,"currency":"DEMO","currencyLabel":"演示币","demo":true,"region":"default","limits":{…}}, "registered": true }
```
错误码：`INVALID_USERNAME` / `WEAK_PASSWORD` / `USERNAME_TAKEN`(409) / `INVALID_CREDENTIALS`(401) / `ACCOUNT_FROZEN`(403) / `ACCOUNT_LOCKED`(429，连续失败 8 次锁 10 分钟，`PLAYER_LOCK_THRESHOLD`/`PLAYER_LOCK_MINUTES`) / `REGISTRATION_CLOSED`(403，后台可关闭注册) / `RATE_LIMITED`(429，按 IP，`LOGIN_RATE_LIMIT_PER_MIN`)。
新注册玩家初始 1000 演示币（`regions.json.startingBalance`）；种子演示玩家 `test01/02/03` 为 10000。**已不再支持免密登录。**
冻结的玩家：已有会话立即失效，不能登录/充值/投注/启动游戏。

### GET `/api/config?region=`
返回币种、地区、品类启用状态、限额、可选地区列表（前端据此灰显未开放品类）。

### GET `/api/games`
过滤参数：`category`(live|slots|table|crash|sports)、`provider`、`subcategory`、`tag`(hot|new|original)、`q`(名称/ID/子类关键词)、`region`、`page`、`limit`(≤200)。
```http
GET /api/games?category=live&provider=demo_live_a&q=百家乐
```
```json
{ "region":"default","total":2,"page":1,"limit":100,
  "games":[{"id":"live-baccarat-a","name":"百家乐 · 示例厅 A","category":"live","subcategory":"baccarat","provider":"demo_live_a","providerLabel":"示例视讯 A","type":"live","orientation":"any","tags":["hot","live"],"demo":true,"playable":true}],
  "providers":[{"id":"demo_live_a","label":"示例视讯 A"}],
  "categories":[{"id":"live","label":"真人视讯","en":"LIVE","enabled":true}], "demo":true }
```
**封面图（可选）**：游戏对象可带 `thumb`（兼容 `cover` / `coverUrl` / `image` / `imageUrl` / `img`），值为 `https://…`、站内 `/…` 路径或 `data:image/…`。大厅 `public/js/cover.js` 检测到该字段后自动用真实封面替换程序化占位封面（`<img loading=lazy>`，加载失败自动回退占位）；无此字段则维持占位封面。平台自带插画/图标/图案在 `public/assets/*.svg`（由 `scripts/build-art.py` 生成）。

未启用地区的品类、以及适配器未启用的供应商游戏**不会**出现在结果中。`type`：`iframe`(第三方网页游戏) / `live`(视讯) / `inhouse`(自研) / `sports`。

### POST `/api/games/:id/launch`
校验：登录、地区品类开关、负责任博彩状态；然后调用适配器 `launch()`。
```json
{ "game": {…}, "launchToken": "lt_…", "orientation": "landscape", "walletMode": "shared", "balance": 1000, "currency": "DEMO",
  "type": "iframe", "mode": "demo", "url": "http://host/demo/provider-game.html?token=lt_…", "method": "GET", "fields": null, "expiresIn": 3600 }
```
`type=inhouse/live/sports` 时返回 `window`（站内页面路径）而不是 `url`。前端把 `url` 放进 iframe（见 §9）。`method=POST` + `fields` 用于需要表单 POST 启动的供应商（前端自行构造隐藏表单提交到 iframe）。

### GET `/api/wallet`
```json
{ "balance": 1000, "currency": "DEMO", "currencyLabel": "演示币", "demo": true, "region": "default", "limits": {…} }
```
### POST `/api/wallet/deposit`（演示）
`{ "amount": 100 }`，受地区 `minDeposit/maxDeposit/maxDailyDeposit` 与负责任博彩限额约束。真实环境由支付通道异步回调入账。
### POST `/api/wallet/transfer`（转账钱包）
`{ "provider":"demo_transfer", "direction":"in|out", "amount":100 }`；`out` 省略 amount = 全部转出。见 §6。
### GET `/api/transactions?limit=50&type=bet`
账本倒序：`txId, provider, type(bet|win|rollback|refund|deposit|transfer_in|transfer_out), amount, balanceAfter, status(ok|rolled_back), roundId, gameId, refTxId, createdAt`。

### 体育
- `GET /api/sports/events?sport=football&live=true` → 赛事 + 赔率（示例）。
- `POST /api/sports/bets`
  ```http
  POST /api/sports/bets            Idempotency-Key: 7f3c…(8-90 位)
  { "type":"parlay", "stake":10, "acceptOddsChange":false,
    "selections":[{"eventId":"ev2","marketId":"m1","outcomeId":"h","odds":2.4},{"eventId":"ev3","marketId":"m1","outcomeId":"a","odds":5.4}] }
  ```
  成功：`{ "bet": {id,type,selections,stake,totalOdds,potentialPayout,status:"open"}, "balance": 990 }`。
  **赔率保护**：提交的 `odds` 与当前不一致 → `409 ODDS_CHANGED` + `changed:[{eventId,outcomeId,oldOdds,odds}]`，前端提示用户确认后以 `acceptOddsChange:true` 重提。`type=single` 只能 1 个选项；`parlay` 2-10 个且不能同场重复。
- `GET /api/sports/bets` 我的注单。`POST /api/sports/bets/:id/settle {result:"won|lost|void"}` 为**开发模拟结算**（`MOCK_ADMIN=0` 关闭），真实环境由赛果/体育供应商推送驱动结算（派彩走 `win`，作废走 `refund`）。

### 自研演示小游戏（⚠ mock RNG，无公平性证明、未认证）
`POST /api/inhouse/crash/{start|cashout}`、`GET /api/inhouse/crash/poll`、`POST /api/inhouse/plinko/drop`、`GET /api/inhouse/plinko/table`、`POST /api/inhouse/mines/{start|reveal|cashout}`、`GET /api/inhouse/mines/state`（断线重连恢复）。结果、地雷位置、崩盘点均由服务端决定，崩盘点在崩盘前不下发。

### 真人视讯演示结算
`POST /api/live/{baccarat|dragontiger|roulette|blackjack}/bet`：`{ "gameId":"live-baccarat-a","bets":[{"spot":"banker","amount":10}] }` → 服务器 mock RNG 开牌并结算。**仅演示**；真实视讯由供应商判定并通过 §5 回调结算。

### 负责任博彩（桩）
`GET /api/rg/status`、`POST /api/rg/limits {dailyDepositLimit,dailyLossLimit}`、`POST /api/rg/exclude {hours,kind:"cooloff|exclude"}`。详见 §11。

---

## 5. 供应商回调（共享钱包）

供应商服务器调用我们的：`POST https://<域名>/provider/<供应商键>/<action>`，`action ∈ balance | bet | win | rollback | refund`。

### 5.1 签名（占位方案，可在适配器中改写）
```
X-Timestamp: 1790843906628                      (毫秒)
X-Signature: hex( HMAC_SHA256( secret, `${X-Timestamp}.${rawBody}` ) )
```
- `rawBody` 是**未经解析的原始请求体字符串**；`secret` 来自 `providers.json`(环境变量)。
- 时间戳偏差 > `SIGNATURE_TOLERANCE_SEC`(默认 300s) 拒绝；比较使用 `timingSafeEqual`。
- 失败返回 `401 {code:"INVALID_SIGNATURE"}`，**不会改动任何余额**。
- 另可配 `ipAllowlist`（供应商出口 IP 白名单）。
- 真实供应商的签名方式千差万别(MD5 拼接、RSA、Header Token…)：在该适配器里覆盖 `verifyCallback()` 即可。

计算示例（Node）：
```js
const ts = Date.now().toString(), raw = JSON.stringify(body);
const sig = require('crypto').createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
```

### 5.2 统一载荷（适配器可翻译供应商自己的字段）
| action | 字段 | 说明 |
|---|---|---|
| `balance` | `userId` | 查余额 |
| `bet` | `userId, txId, amount, roundId, gameId` | 扣款。`amount>0` |
| `win` | `userId, txId, amount, roundId, gameId` | 派彩。`amount>=0`（0 = 输局结算，不动账） |
| `rollback` | `userId, txId, refTxId` | 技术性冲正（超时/失败）：撤销 `refTxId` 对应的 bet 或 win |
| `refund` | `userId, txId, refTxId` | 业务性退款：作废某笔 **bet**（取消/封盘/作废） |

### 5.3 响应
```json
{ "ok": true, "txId":"b-1001", "type":"bet", "amount":25.5, "balance":974.5, "currency":"DEMO", "roundId":"rA", "createdAt":1790843906628, "status":"ok" }
```
重复请求：同样的 200 + `"duplicate": true` 与**当前**余额。错误：`4xx/409 {ok:false, code, message}`。需要特殊响应格式的供应商，在适配器 `formatResponse/formatError` 里转换（例如供应商要求总是 HTTP 200 + 自定义 status 码）。

```bash
# 示例：模拟供应商下注
BODY='{"userId":"u_xxx","txId":"b-1001","amount":25.5,"roundId":"rA","gameId":"slot-01"}'
TS=$(date +%s%3N); SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac 'dev-slot-a-secret' -hex | sed 's/^.* //')
curl -X POST localhost:8088/provider/demo_slot_a/bet -H "X-Timestamp: $TS" -H "X-Signature: $SIG" -H 'Content-Type: application/json' -d "$BODY"
```

## 6. 钱包流程：共享钱包 vs 转账钱包

| | 共享钱包 (Seamless / Single wallet) | 转账钱包 (Transfer / Fund transfer) |
|---|---|---|
| 资金在哪 | 只在**我们**账本 | 玩前转入供应商，玩后转出 |
| 每次下注 | 供应商**实时回调** `bet/win`，我们扣/加款 | 供应商内部结算，不回调 |
| 优点 | 单一余额，体验好；风控/限额实时生效；无需结算对账转账 | 供应商接口简单；不需要对外暴露高可用回调 |
| 缺点 | 我们的回调必须**高可用、低延迟(通常<1~3s)、强幂等** | 余额分散；转账失败/掉线易产生“滞留资金”；需定时对账与回收 |
| 本项目 | `walletMode:"shared"`，`/provider/:name/*` | `walletMode:"transfer"`，`POST /api/wallet/transfer` → `adapter.transferIn/transferOut/queryBalance` |

**共享钱包时序**
```
玩家 → 我们: launch ──▶ 供应商: 创建会话(player=userId/launchToken) ──▶ 返回 URL ──▶ iframe
玩家点击下注 ─▶ 供应商 ─▶ 我们 POST /provider/x/bet (幂等) ─▶ 扣款 ─▶ 返回新余额
结算 ─▶ 供应商 ─▶ 我们 POST /provider/x/win (幂等) ─▶ 加款
异常(超时/重复/取消) ─▶ rollback / refund (引用原 txId)
```
**转账钱包时序**
```
launch 前(或 launch 内)：adapter.transferIn(amount)  → 平台余额 -amount，供应商钱包 +amount
游戏期间：全部在供应商内完成
退出/结束/超时：adapter.transferOut()  → 供应商钱包清零，平台余额 +amount
崩溃恢复：定时任务查询 queryBalance，对未转出且离线的玩家强制转出
```
转入/转出每一笔都有 `txId`（`Idempotency-Key`），重试不重复入账。

## 7. 幂等与冲正规则

实现位置：`server/lib/wallet.js`（顶部注释即规则说明），已被 `server/test/run.js` 覆盖。

1. **幂等键 = (provider, txId)**。同键、同载荷重复 → 返回首次结果 + `duplicate:true`，余额不再变化（并发 20 个同 txId 请求测试只扣一次）。
2. **同键不同载荷**（金额/玩家/类型不同）→ `409 IDEMPOTENCY_CONFLICT`，不动账。
3. **一笔 bet/win 最多被冲正一次**。对已冲正的交易再发 rollback/refund（即使 txId 不同）→ 返回成功 + `alreadyReversed:true`，不再动账。
4. **rollback vs refund**：`rollback` 可冲正 bet 或 win（win 的冲正会扣回派彩，余额不足 → 402 需人工处理）；`refund` 只用于 bet。
5. **乱序（冲正先到、原交易后到）**：先写“墓碑”记录，随后到达的原 `bet` 返回 `409 TX_CANCELLED`，**不扣款**。
6. **轮次一致性**：同 `roundId` 已有被冲正的 bet 时，该轮的新 `win` → `409 ROUND_CANCELLED`；该轮新 bet 同样拒绝。
7. **余额不为负**：bet 余额不足 → `402 INSUFFICIENT_FUNDS`，不动账。
8. **只增不改的账本**：每笔操作一条 ledger，`ref.status` 仅从 `ok` → `rolled_back`。对账公式：`余额 = 初始 + Σ(deposit + win + rollback(bet) + refund) − Σ(bet) − Σ(rollback(win))`。
9. **返回码约定给供应商**：重复请求必须返回与首次**相同语义**的成功，供应商才会停止重试；因此重复 = 200。
10. 迁移数据库时：`ledger` 对 `(provider, txId)` 建**唯一索引**；余额变更与 ledger 写入放在**同一事务**并对用户行加锁(`SELECT … FOR UPDATE`)；墓碑与冲正标记同样在该事务内。

## 8. 如何新增一个供应商适配器

1. 复制模板：`cp server/adapters/_template.js server/adapters/acme.js`，类名保持 `module.exports = class …`。
2. 在 `server/config/providers.json` 增加：
   ```json
   "acme": { "enabled": true, "adapter": "acme", "label": "ACME 视讯", "walletMode": "shared",
             "baseUrl": "${ACME_BASE_URL}", "apiKey": "${ACME_API_KEY}", "secret": "${ACME_SECRET}",
             "currency": "CNY", "ipAllowlist": ["203.0.113.10"] }
   ```
   并在部署环境设置 `ACME_BASE_URL / ACME_API_KEY / ACME_SECRET`（**不要入库**）。
3. 实现模板里的方法（每个方法在模板中都有注释和示例）：
   - `launch(ctx)`：调用供应商“创建会话/取游戏链接”→ 返回 `{url, method?, fields?, expiresIn, mode:'real'|'demo'}`。`ctx` 含 `user / game / device / lang / currency / launchToken / returnUrl / callbackBase`。
   - `verifyCallback(req)`：按供应商文档验签（默认 HMAC 占位）。
   - `parseCallback(action, req)`：把供应商字段翻译成统一结构 `{userId, txId, amount, roundId, gameId, refTxId}`。
   - `formatResponse / formatError`：把统一结果翻译成供应商要求的响应。
   - `listGames()`（可选）：返回统一结构游戏数组，`null` 则使用静态 `config/games.json`。
   - 转账钱包：`transferIn / transferOut / queryBalance`。
4. 游戏目录：在 `config/games.json` 增加条目（`provider` 填 providers.json 的键，`type:"iframe"`，`orientation:"landscape"` 用于老虎机），或用 `listGames()` 同步。
5. 在供应商后台把回调 URL 配成 `https://<域名>/provider/acme/{balance|bet|win|rollback|refund}`。
6. 验证清单：沙箱走通 `launch → bet → win → rollback → 重复请求`；跑 `node server/test/run.js`；参考 `test/run.js` 为新适配器增加用例（特别是签名与字段映射）。
7. 去掉 mock：把 `inhouse / demo_*` 等演示供应商设为 `enabled:false`，并移除 `games.json` 中的演示游戏。

## 9. 前端 postMessage 桥

实现：`public/js/gamewindow.js`。iframe 游戏页（真实供应商需要支持或由其 SDK/包装页提供）与宿主通信：

```js
// 消息统一格式
{ source: '8k', v: 1, type: '<type>', id?: '<关联 id>', payload?: {…} }
```
| 方向 | type | payload | 作用 |
|---|---|---|---|
| iframe→宿主 | `ready` | `{game}` | 游戏就绪，宿主隐藏 loading 并发送 `init` |
| | `loaded` | – | 仅隐藏 loading |
| | `error` | `{message}` | 显示错误页 + 重连按钮 |
| | `getBalance` | – | 宿主回 `balance`（带同一 `id`） |
| | `roundStart` / `roundEnd` | 任意 | 宿主刷新服务端余额（共享钱包以服务端为准） |
| | `close` / `requestFullscreen` | – | 返回大厅 / 切换全屏 |
| 宿主→iframe | `init` | `{token,balance,currency,lang,muted,landscape}` | 初始化 |
| | `balance` | `{balance,currency}` | 余额推送/回应 |
| | `sound` | `{muted}` | 静音开关 |
| | `visibility` | `{hidden}` | 切后台暂停 |
| | `orientation` | `{landscape}` | 方向变化 |

**安全**：宿主只接受 `event.source === iframe.contentWindow` **且** `event.origin` 在白名单（launch URL 的 origin ∪ launch 返回的 `allowedOrigins`）内的消息；发送时指定目标 origin，不使用 `*`。iframe 使用 `sandbox` 属性；响应头 CSP 的 `frame-src` 目前为 `'self' https:`，**上线前请收窄为供应商域名白名单**（`lib/http.js`）。多数供应商不支持此自定义协议，这时用 `onRawMessage` 钩子接其原生消息，或让供应商页面只负责游戏、余额依旧由宿主轮询 `/api/wallet`。

**窗口行为**：移动端全屏（`100dvh` + `--vh` 兜底 + 安全区 inset）；`orientation:"landscape"` 的游戏在竖屏手机上显示“请旋转设备”提示（可跳过）；全屏优先用 Fullscreen API 并尝试 `screen.orientation.lock('landscape')`；iPhone Safari 不支持元素全屏，退化为“沉浸模式”（收起顶栏，点击顶部边缘唤出）；加载超时 20s / 断网 / iframe 报错 → 错误页 + “重新连接”（会重新调用 launch 获取新 token）；`offline/online` 事件有横幅提示；切后台通知 iframe 暂停。

## 10. 地区开关与限额（默认全开）

**当前策略：所有地区/品类全部开放，不做任何按国家/地区的游戏过滤，投注与充值限额默认不设上限。**

`server/config/regions.json` 只保留 `default` 一个地区：
```json
"default": {
  "categories": { "slots": true, "fishing": true, "live": true, "table": true, "crash": true, "sports": true },
  "limits": { "minBet": null, "maxBet": null, "minDeposit": null, "maxDeposit": null, "maxDailyDeposit": null },
  "categoryLimits": {}, "realityCheckMinutes": null, "ageGate": null }
```
- 限额字段 `null` = **不设上限/下限**。
- 未在配置里出现的品类/地区一律视为开放（只有显式写 `false` 才会关闭）；大厅在只有 1 个地区时隐藏地区选择。
- `lib/geo.js` 的开关机制保留（品类关闭时 `/api/games` 不返回、launch 与回调返回 `403 CATEGORY_DISABLED`），但**默认不启用**，测试里会临时注入受限地区来验证机制。**没有也不会添加按玩家国家过滤游戏目录的逻辑。**
- ⚠ 法务提示：全开放不等于合规。各司法辖区对在线博彩、特定供应商/品类的限制仍需您与法务确认（见 §13）。

## 11. 负责任博彩钩子

`server/lib/rg.js` 目前是**内存桩**，调用点已就位：
- `beforeBet()`：每次 `wallet.bet` 与 `launch` 前调用（自我排除、冷静期；每日亏损限额留 TODO）。
- `beforeDeposit()`：充值前（自我排除、用户自设每日充值上限）。
- `realityCheck()`：按地区 `realityCheckMinutes` 返回是否到提醒时间（`GET /api/me` 的 `rg.realityCheck`）；前端尚未弹窗（缺口）。
- 接口：`/api/rg/status|limits|exclude`；前端「我的」里有演示入口，页脚有 18+ 与求助热线占位。
真实上线需：自我排除登记库对接、KYC/年龄核验、冷静期不可撤销规则、亏损/时长限额、交易监控(AML)、求助热线本地化。

## 12. 安全注意事项

- **密钥**：`apiKey/secret` 只放环境变量/密钥管理，不入库、不进前端；轮换时可在适配器里支持“新旧双 secret”。
- **回调**：必须验签 + 时间窗 + 可选 IP 白名单；回调接口单独限流与告警；日志不得打印完整 body/签名。
- **HTTPS/HSTS**：生产强制 HTTPS（反向代理处理），并设置 `PUBLIC_BASE_URL`；加 `Strict-Transport-Security`。
- **会话**：mock 用不透明 Bearer token（内存）。生产建议短期 JWT/服务端会话 + 刷新令牌、设备绑定、2FA；token 不放 URL。`launchToken` 一次性/短时效，仅供供应商识别玩家。
- **金额**：整数分计算；服务端为准，永不信任前端金额/赔率（体育已做赔率二次校验）。
- **CSP / iframe**：当前 `frame-src https:` 过宽，上线收窄；iframe 加 `sandbox`；postMessage 严格校验 origin。
- **限流/风控**：内存限流仅为示意，生产在网关/WAF 实施，并做设备指纹、多账户、套利监控。
- **RNG / 公平性**：`lib/inhouse.js`、`lib/live.js` 使用 `crypto.randomInt` 仅供演示，无 provably-fair/认证。上线自研游戏需认证实验室(GLI/iTech 等)与监管批准。
- **CORS**：默认同源，不开放跨域；需要时通过 `ALLOWED_ORIGINS` 精确列出。
- **X-Region / X-Forwarded-For**：这些头只有在受信任代理后才可信；否则客户端可伪造。
- **关闭演示端点**：生产 `MOCK_ADMIN=0`，并从 `providers.json` 移除 `mock` 适配器。

## 13. 上线前需要您提供的清单

**A. 牌照与合规**
- [ ] 运营牌照(发牌机构/编号/适用地区)，各地区允许的品类清单 → 填 `regions.json`
- [ ] 年龄门槛、KYC/反洗钱流程、自我排除登记库对接、求助热线文案
- [ ] 各地区投注/充值限额策略（如需）；负责任博彩政策文案
- [ ] 隐私政策、服务条款、Cookie 策略

**B. 游戏供应商（每个供应商一份）**
- [ ] 对接文档（启动游戏 API、回调规范、签名算法、错误码、重试策略）
- [ ] 沙箱/生产的 `baseUrl`、`apiKey`、`secret`（或证书）、商户号/运营商 ID
- [ ] 钱包模式：共享钱包 or 转账钱包；回调超时要求(秒)、币种与精度
- [ ] 游戏清单(ID、名称、类型、缩略图、RTP、横竖屏、是否支持试玩)与授权的图片/素材
- [ ] 供应商出口 IP 白名单；我方需向其提供的回调域名/IP
- [ ] 视讯：视频流嵌入方式(iframe/SDK)、桌台状态/路单数据接口
- [ ] 体育：赔率/赛事数据源 API、投注接受/结算/取消推送规范、串关与赔率变动规则

**C. 基础设施与域名**
- [ ] 正式域名(主站/API/回调域名)与 TLS 证书；CDN 方案
- [ ] 数据库（建议 PostgreSQL）、缓存(Redis)、消息队列(对账/重试)、日志与监控告警
- [ ] 支付通道（充值/提现）文档与密钥
- [ ] Geo-IP 服务、短信/邮件服务、客服系统

**D. 品牌素材**
- [ ] 游戏封面、供应商 Logo（授权）、真实 Logo/字体授权 —— 当前缩略图为程序生成的渐变 + 大字占位。

## 14. 已知缺口 / 生产化待办

- 存储：默认内存 + `DATA_DIR` 下的 JSON 文件快照（原子写，见 §17）。仅单实例；没有多实例一致性；账本只持久化最近 20000 条；体育注单、转账钱包的供应商侧余额镜像、会话不持久化。生产需上数据库并按 §7(10) 实现事务与唯一索引。
- 玩家登录为用户名+密码（scrypt），但无邮箱/手机验证、找回密码、2FA、KYC；无真实支付、无提现。后台为单角色管理员（无 RBAC/2FA）。
- 视讯无真实视频；路单为随机占位；二十一点演示规则极简化。
- Reality check 前端弹窗未实现；每日亏损限额仅留 TODO。
- 通用供应商回调默认仍是 HMAC 占位方案；HUIDU 已按其文档实现（§15）。
- HUIDU 对账仅提供按需调用的 `reconcile()`，没有定时任务/告警；转账钱包超时单只记录在 `pending`，无自动补偿。其余缺口见 §15.9。

---

## 15. HUIDU（GameApi）集成

依据：`/workspace/gameapi/ANALYSIS.md`（§8.5 适配器方案、§11 待确认问题）。实现：`server/adapters/huidu.js`、`server/lib/huidu-crypto.js`、`server/lib/alias.js`、模拟器 `server/sim/huidu-sim.js`。提供商 ID：`huidu_seamless`（`config/providers.json`，默认启用）。

### 15.1 回调入口（单一 URL）
```
POST /provider/huidu_seamless/callback        ← 只需向 HUIDU 提供这一个 URL，路径里没有 action
```
请求体：`{ "agency_uid": "...", "timestamp": "...", "payload": "<AES 密文 Base64>" }`
流程：解密 → 校验 `agency_uid` 与 payload 内 `timestamp`（窗口 `HUIDU_TS_TOLERANCE_SEC`，默认 86400 秒，0=不校验）→（可选）IP 白名单 `ipAllowlist` → 动作解析（固定 `settle`）→ 钱包 `settle`（幂等）→ 加密响应。

响应：**HTTP 恒为 200**。
```json
{ "code": 0, "msg": "", "payload": "<AES({ credit_amount:"123.45", timestamp:"…" })>" }
```
- `code` 0=成功，1=失败（`msg` 为我方错误码，如 `INSUFFICIENT_FUNDS`、`CURRENCY_MISMATCH`、`PLAYER_NOT_FOUND`、`INVALID_AMOUNT`）。
- **无论成功失败都返回玩家当前余额**（`credit_amount`，主币单位，两位小数）；玩家未知时为 `0.00`；无法解密时（无从得知玩家）只返回 `{code:1,msg:"payload error"}`。
- 入口对所有异常（含非法 JSON、未知路径子动作）统一回 HTTP 200 + code 1，避免触发供应商无谓重试逻辑差异。

### 15.2 加密（严格按 ANALYSIS.md）
- 算法 **AES-256-ECB + PKCS7 + Base64**；密钥为 **32 个 ASCII 字符**（直接作 32 字节），非 32 字符一律拒绝并在启动时报 `configError`。
- 明文为 JSON 字符串。实现：`lib/huidu-crypto.js`（`encrypt/decrypt/decryptText/validKey`），已用 openssl 已知答案向量校验：密钥 `abcdefghijklmnopqrstuvwxyz012345`（测试专用假密钥）、明文 `{"hello":"world","n":1}` → `44lmPmymlivOQrpC+mz3DkMIzrrjmPK9ELAZVAUEJj0=`。
- ⚠ **公开文档中的示例密钥/agency 一律视为已泄漏，代码、配置、测试中均不含**（测试里有一项“源码不含硬编码密钥”的检查）。真实密钥只通过环境变量注入。
- ECB 无完整性保护（供应商协议所限）：依赖 TLS、IP 白名单、`serial_number` 幂等与对账兜底。

### 15.3 `settle` 操作与幂等
钱包核心新增 `wallet.settle({provider, txId, userId, bet, win, roundId, gameId})`（单位：分，整数）：
- 一次回调 = 一次“下注+派彩”合并结算，净变动 `delta = win − bet`；`win` 可为 **0**（输局）；
- **负数 = 退款/冲回**（HUIDU 语义：`bet_amount`/`win_amount` 可为负），按带符号数值入账；
- 余额检查按净额：`balance + delta < 0` → `INSUFFICIENT_FUNDS`（失败不记账，仍返回余额）；
- 幂等键 `(provider, serial_number)`：同键重放返回**首次结果**，不重复记账；同键但金额不同 → 冲突，`code 1`；
- 限额/负责任博彩前置检查仅当 `bet > 0` 时执行；
- 账本记录 `type:"settle"`，`/api/transactions` 同时暴露 `bet`、`win`（前端显示“结算”）。

### 15.4 玩家别名 `member_account`
HUIDU 要求仅 `a-z0-9` 且长度受限。`lib/alias.js`：`别名 = aliasPrefix(默认 k8) + sha256(provider|userId) 十六进制`，截断至 ≤20 位，内存双向映射（`store.aliasToUser/userToAlias`）。内部用户 ID 不外泄；回调按别名反查内部 ID，找不到 → `PLAYER_NOT_FOUND`（仍 code 1 + 余额 0.00）。前缀由 `HUIDU_ALIAS_PREFIX` 配置。⚠ 映射目前在内存，上线需持久化（别名是确定性哈希，可重建，但需保证规则永不变更）。

### 15.5 钱包模式（配置选择）
| 模式 | 配置 | 行为 |
|---|---|---|
| 共享钱包 shared（默认） | `HUIDU_WALLET_MODE=shared` | 启动游戏不转账；HUIDU 每局回调 `settle`，我方实时记账 |
| 转账钱包 transfer | `HUIDU_WALLET_MODE=transfer` | launch 前 `transferIn`（本地先扣、调用失败/超时则补偿；超时单进入 `pending` 待人工/对账），离场 `transferOut`（`queryBalance` 取回余额后转回） |

⚠ 一个代理账号只能用一种模式（错误码 10024）。若要同时提供两种，需要向 HUIDU 申请**第二个代理账号**并启用 `huidu_transfer`（`HUIDU_TRANSFER_BASE_URL/AGENCY_UID/AES_KEY`，默认 disabled/hidden）。

### 15.6 环境变量
| 变量 | 说明 |
|---|---|
| `HUIDU_BASE_URL` | HUIDU 服务地址（测试/生产分别提供） |
| `HUIDU_AGENCY_UID` | 代理识别码 |
| `HUIDU_AES_KEY` | 32 字符 AES-256 密钥（**保密**，只放环境变量/密钥管理） |
| `HUIDU_CURRENCY` | 玩家币种，默认 `USD`（同一玩家币种固定，错误码 10011；回调币种不符 → `CURRENCY_MISMATCH`）；本平台仅单一币种，按 1:1 映射，无汇率 |
| `HUIDU_WALLET_MODE` | `shared`(默认) / `transfer` |
| `HUIDU_SIMULATOR` | `auto`(默认：三项凭据不全时使用本地模拟器) / `on`(强制) / `off`(禁用，凭据不全则 launch 报 `PROVIDER_NOT_CONFIGURED`) |
| `HUIDU_AUTO_TRANSFER` | 转账模式转入金额策略，默认 `all` |
| `HUIDU_TS_TOLERANCE_SEC` | 回调时间窗，默认 86400 |
| `HUIDU_ALIAS_PREFIX` | 别名前缀，默认 `k8` |

### 15.7 适配器能力
- **启动游戏**：`/game/v1`（含 `game_uid`、`member_account`、`currency_code`、语言/回跳等）与 `/game/v2`；HUIDU 错误码已映射为平台错误码（如 10011 币种锁定、10024 钱包模式冲突、维护/超时/下架）。
- **目录同步**：`listProviders()` / `listGames()` / `syncCatalog({apply})`；过滤下架/暂停/维护厂商及 `status≠1` 的游戏。命令行：`node server/scripts/huidu-sync.js [--write]`（`--write` 写出 `config/games.huidu-synced.json`，不覆盖精选清单，需人工审阅后合并）。
- **交易对账**：`reconcile({date})` 分页拉取 `/game/transaction/list` 与本地账本比对，输出缺失/金额不一致/多出的交易。目前为按需调用。
- **本地模拟器**：`node server/sim/huidu-sim.js`（`HUIDU_SIM_PORT` 默认 8090，`HUIDU_SIM_MODE=shared|transfer`，凭据读 `HUIDU_SIM_AGENCY_UID/HUIDU_SIM_AES_KEY`，缺省则随机生成并打印）。模拟 `/game/v1`、`/game/v2`、`/game/transaction/list`、`/game/providers`、`/game/list`，按文档错误码返回；会发起加密 `settle` 回调（含失败重发）；可注入故障 `setFail('maintenance'|'hang'|'transfer')`。**只模拟文档明确的行为**，真实时序/重试/超时仍待 HUIDU 确认（§15.8）。
- **演示**：大厅点任一 HUIDU 游戏 → 模拟器返回同源演示页 `public/demo/huidu-game.html`，旋转时经 `/api/mock/huidu-spin` 触发模拟器发加密 `settle` 回调，余额随之变化。

### 15.8 您需要提供 / 向 HUIDU 确认
**A. 必须提供**
- [ ] **真实凭据**：`HUIDU_AGENCY_UID`、`HUIDU_AES_KEY`（32 字符）——通过环境变量/密钥管理注入，**不要提交到仓库、不要发聊天**；如公开文档里的示例密钥曾被使用，请要求 HUIDU 更换。
- [ ] **测试与生产的 `HUIDU_BASE_URL`**，以及测试环境凭据、可用币种（如 INR/USD…）与小数位规则。
- [ ] **IP 白名单**：① HUIDU 回调出口 IP 列表 → 填入 `providers.json` 的 `ipAllowlist`；② 我方服务器出口 IP 是否需要提交给 HUIDU 加白（若需要，提供固定出口 IP）。
- [ ] **回调 URL（公网 HTTPS）**：`https://<您的域名>/provider/huidu_seamless/callback`，需把该 URL 登记到 HUIDU 后台，并确保 TLS 证书有效、反向代理透传 `X-Forwarded-For`。
- [ ] 钱包模式决定（共享 / 转账，一个代理账号只能一种）。

**B. 请向 HUIDU 确认（ANALYSIS §11）**：回调超时时限与重试策略（次数/间隔/幂等字段）；负数 `bet_amount`/`win_amount` 的准确语义与是否带原单引用；`timestamp` 格式（秒/毫秒/字符串）及允许偏差；v1 中 `credit_amount` 的含义；转账模式是否支持按转账单号查询；各币种小数位；接口限流；游戏图片/素材授权与可用地区；厂商是否有地区限制。
**C. 自身侧**：各司法辖区合规/牌照矩阵（本平台不做地区过滤，见 §10）、数据库持久化（别名/账本/幂等表/pending 转账）、对账调度与告警。

### 15.9 HUIDU 相关已知缺口
- 回调时间窗默认 24 小时（宽松以免误拒合法重试；重放防护靠 `serial_number` 幂等）。
- `settle` 是事后净额检查：`bet > 余额` 但净额 ≥ 0 也会通过；没有下注前预占。
- 负数金额冲回没有原单引用，无法强制“只冲一次”。
- 单币种（DEMO/配置币种 1:1），玩家币种锁定（10011）未持久化。
- 内存存储（别名/账本/pending 重启丢失）；转账模式超时无自动补偿（HUIDU 无按转账单号查询接口）；前端暂无“退出游戏→转出”界面；对账无调度。
- 模拟器≠真实 HUIDU，上线前必须在其测试环境联调。

---

## 16. 大厅与目录（170 款精选 / 捕鱼）

- **目录来源**：`config/games.json`（自研 Crash/Plinko/Mines 演示 + 真人/体育壳）合并 `config/games.huidu-shortlist.json`（170 款精选，详见 `shortlist.md/csv`）。`CATALOG_HUIDU=0` 可关闭合并。精选游戏均走 `huidu_seamless`，缺图，封面由前端按厂商生成渐变 + 品类图案（内联 CSS/SVG，无外网）。
- **品类**（顺序）：老虎机 slots、**捕鱼 fishing**（新增，10 款）、真人 live、桌游 table、Crash、体育 sports。
- **`GET /api/games`**：新增 `vendor` 过滤；`q` 支持中文别名搜索（如 `麻将`→mahjong、`捕鱼`→fish，见 `lib/search.js`）；`limit` 最大 1000；响应含 `aliases`。内部字段（providerGameId、rawType 等）不对外。
- **前端大厅**：一次拉取全部游戏、客户端筛选（品类标签带数量、厂商下拉、搜索、快捷 chip 含 麻将）；分批（24/批）懒渲染 + `IntersectionObserver` 哨兵（每批后重新观察，避免大屏/WebKit 卡住）+ `content-visibility:auto`，移动端 170+ 款流畅；所有可点击目标 ≥44px。

---

## 17. 玩家认证、后台管理（/admin）与持久化

### 17.1 持久化（`DATA_DIR`）
- 目录：环境变量 `DATA_DIR`（默认 `<项目根>/data`，已在 `.gitignore`）；`DATA_DIR=off`（或 `memory`）关闭落盘。
- 文件：`users.json`（玩家，含 scrypt 哈希与冻结状态）、`ledger.json`（最近 `LEDGER_PERSIST_MAX`=20000 条账本）、`admin.json`（管理员、站点设置、游戏运营覆盖、审计日志）。
- **原子写**：写 `<file>.<pid>.<ts>.tmp` → `fsync` → `rename` 覆盖 → `fsync` 目录；写入防抖（`PERSIST_DELAY_MS`，默认 1500ms），进程退出 / `SIGTERM` / `SIGINT` 时同步落盘。读取到损坏 JSON 时改名为 `*.corrupt-<ts>` 并以默认值启动。
- 免费托管的磁盘是临时的（见 `DEPLOY.md`）：重启/休眠/重新部署后数据重置。

### 17.2 演示账号（仅演示！）
| 角色 | 账号 | 密码 | 说明 |
|---|---|---|---|
| 玩家 | `test01` `test02` `test03` | `Test@2026` | 演示币余额 10000 |
| 管理员 | `admin` | `Admin@2026!` | 登录 `/admin` |

环境变量覆盖：`ADMIN_USERNAME`+`ADMIN_PASSWORD`（设置后每次启动以它们为准）、`DEMO_PLAYERS`、`DEMO_PLAYER_PASSWORD`、`DEMO_PLAYER_BALANCE`、`SEED_DEMO=0`（不创建演示玩家）、`SHOW_DEMO_ACCOUNTS=0`（登录页不显示演示账号提示）。已存在的账号不会被重置余额。

### 17.3 后台 API（`/api/admin/*`）
- **认证**：`POST /api/admin/login {username,password}` → `Set-Cookie: k8_admin=…; HttpOnly; SameSite=Strict; Path=/api/admin`（HTTPS 下加 `Secure`），响应里带 `csrf`。会话仅存内存（令牌只保留 SHA-256 摘要）：空闲 2 小时 / 绝对 12 小时过期。与玩家 Bearer 令牌**完全分离**（互不通用）。
- **CSRF**：所有 `POST`（除登录）必须带 `X-CSRF-Token: <csrf>`，并校验 `Origin` 与 `Host` 同源。
- **限流/锁定**：登录按 IP 限流（`ADMIN_LOGIN_RATE_LIMIT`，默认 10 次/5 分钟 → 429 + `Retry-After`）；同一账号连续失败 5 次锁 15 分钟（`ADMIN_LOCK_THRESHOLD`/`ADMIN_LOCK_MINUTES`）。
- 变更类接口一律 `POST`（本服务器只实现 GET/POST）。所有写操作写入审计日志。

| 接口 | 说明 |
|---|---|
| `GET /api/admin/session` | 无需登录，探测会话 `{authenticated, admin?, csrf?}` |
| `POST /api/admin/login` · `/logout` · `/password` | 登录 / 登出 / 修改管理员密码（弱密码拒绝，其它会话下线） |
| `GET /api/admin/me` | 当前管理员 + csrf |
| `GET /api/admin/dashboard` | 玩家数(总/今日新增/24h 活跃/冻结)、钱包总额、累计与今日 投注/派彩/**GGR**/RTP、局数、充值、调整净额、近 7 日序列（UTC+8 切日，`ADMIN_TZ_OFFSET_MIN`）、热门游戏 TOP6、最近 10 笔交易、游戏上架数 |
| `GET /api/admin/players?q=&status=active\|frozen&sort=created\|balance\|bet\|login&page=&limit=` | 玩家列表 + 统计 |
| `GET /api/admin/players/:id?page=&limit=` | 玩家详情 + 钱包账本 |
| `POST /api/admin/players/:id/adjust {amount, reason}` | 调整演示余额（可正可负，必填原因；不得扣成负数；写入账本 `type=adjust, provider=admin`） |
| `POST /api/admin/players/:id/freeze {frozen, reason}` | 冻结/解冻（冻结必填原因，立即踢下线） |
| `POST /api/admin/players/:id/password {password}` | 重置玩家密码 |
| `GET /api/admin/games?q=&category=&provider=&enabled=1\|0&flag=hot\|new&page=&limit=` | 186 款游戏 + 运营覆盖状态 |
| `POST /api/admin/games/:id {enabled?,hot?,isNew?,sort?,category?,reset?}` | 启停 / 热门 / 新游 / 排序(越小越靠前) / 分类；`reset:true` 恢复默认 |
| `POST /api/admin/games/bulk {ids[], …同上}` | 批量（≤500） |
| `GET /api/admin/providers` | 供应商状态：模式(simulator/live/mock/disabled)、钱包模式、凭据**是否已配置**（布尔，绝不返回值）、上游主机、IP 白名单条数、游戏数、24h 交易与 GGR |
| `GET /api/admin/transactions?type=&status=&provider=&player=&game=&q=&from=&to=&min=&max=&page=&limit=` | 交易查询：多条件组合 + 汇总（投注/派彩/GGR）；`from/to` 支持 `YYYY-MM-DD`（按 UTC+8）或毫秒时间戳 |
| `GET/POST /api/admin/settings` | 站点横幅 `maintenance{enabled,text,level}`、`blockPlay`（维护模式禁止启动游戏）、`registrationOpen`；另返回系统信息 |
| `GET /api/admin/audit?limit=` | 审计日志 |

公开接口的联动：`GET /api/config` 新增 `maintenance`（横幅，前台各页面顶部显示）、`registrationOpen`、`demoLogin`；`GET /api/games` 不返回已下架游戏并按后台“排序”输出，`/api/games/:id` 与启动接口对下架游戏返回 404；`blockPlay` 开启时启动游戏返回 `503 MAINTENANCE`。
GGR（演示币）= 投注 − 派彩；已冲正的 bet/win 不计入，充值/调整/转账不计入 GGR。

### 17.4 部署
见 `DEPLOY.md`（Dockerfile、`render.yaml`、免费档限制）。反向代理后请设置 `TRUST_PROXY=1`。
