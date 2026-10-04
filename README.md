# 8K 游戏平台（演示 / Mock）

静态前端（原生 JS ES 模块，无构建、无 CDN）+ **零依赖 Node 20** Mock API + **后台管理 `/admin`**，同一个 Node 服务即可运行与部署。设计令牌取自 `../8k-home/index-v3-opt.html`（`public/css/tokens.css`）。
**全部游戏 / 赔率 / 余额均为示例与演示币，不涉及真实资金。**

```bash
PORT=8088 node server/index.js      # 前台 http://localhost:8088   后台 http://localhost:8088/admin
node server/test/run.js             # 集成测试（见下）
node server/sim/huidu-sim.js        # 独立 HUIDU 模拟器（默认 :8090）
node server/scripts/huidu-sync.js   # 同步 HUIDU 游戏目录（无凭据则用模拟器）
```

## 大厅内容
大厅**只有 HUIDU 精选清单的 170 款游戏**（`server/config/games.huidu-shortlist.json`，来自 `shortlist.csv`）：老虎机 80 · 真人视讯 30 · 棋牌 20 · 捕鱼 10 · 小游戏 25 · 体育 5，共 40 家厂商；全部经 `huidu_seamless` 供应商 iframe 窗口启动。**平台不含任何自研/演示原创游戏**（Crash / Plinko / Mines 等自研游戏及其页面、接口、测试已全部删除；清单里 Spribe/JILI 等厂商自带的同名游戏属于 HUIDU 供应商游戏，予以保留）。
封面：`public/assets/covers/<game_uid>.webp`（HUIDU 素材包，170 张）；厂商 logo：`public/assets/logos/`。缺图时自动使用按游戏 id 生成的占位封面。默认列表为跨品类/跨厂商“混排”顺序。
注册 / 登录成功后一律回到大厅 `/`（`?next=` 仅允许站内路径，旧的 `/games/*`、`/live.html`、`/sports.html` 会被忽略）。

## 演示账号（⚠ 仅限演示环境，公开部署前务必修改）

| 角色 | 入口 | 账号 | 密码 | 备注 |
|---|---|---|---|---|
| 玩家 | `/login.html`（注册：`/register.html`） | `test01` `test02` `test03` | `Test@2026` | 演示币余额 10000 |
| 管理员 | `/admin` | `admin` | `Admin@2026!` | 与玩家账号体系完全分离 |

- 玩家密码用 **scrypt** 哈希（含盐）存储；管理员同样。新注册玩家送 1000 演示币。
- 环境变量可覆盖：`ADMIN_USERNAME` / `ADMIN_PASSWORD`、`DEMO_PLAYERS`、`DEMO_PLAYER_PASSWORD`、`DEMO_PLAYER_BALANCE`、`SEED_DEMO=0`（不创建演示玩家）、`SHOW_DEMO_ACCOUNTS=0`（登录页不显示演示账号提示）。详见 `.env.example`、`API.md` §17。
- 数据持久化到 `DATA_DIR`（默认 `./data`，`DATA_DIR=off` 关闭）：原子写 JSON，重启后保留。免费托管的磁盘是临时的，见 `DEPLOY.md`。

## 后台管理（/admin，中文，响应式，暮光玫瑰金风格）
仪表盘（玩家 / 钱包总额 / 投注·派彩·GGR·RTP / 近 7 日图表 / 热门游戏 / 最近交易）· 玩家管理（搜索、钱包与账本、调整演示余额、冻结/解冻、重置密码）· 游戏管理（186 款上下架、热门/新游标记、排序、分类、批量）· 供应商状态（不显示任何密钥）· 交易查询（类型/玩家/游戏/来源/状态/日期/金额/单号 多条件）· 系统设置（站点维护横幅、维护模式、开放注册、改密、审计日志）。
API 在 `/api/admin/*`：Cookie 会话（HttpOnly + SameSite=Strict）+ CSRF 令牌 + 登录限流/账号锁定；详见 `API.md` §17。

## 测试与截图
```bash
node server/test/run.js             # 65 项集成测试（含：scrypt 登录/注册、后台鉴权/CSRF/限流/锁定、仪表盘数值、玩家调整/冻结、
                                    #   游戏启停影响前台、供应商不泄密、交易过滤、维护横幅、重启持久化、环境变量覆盖、HUIDU 加密/settle/模拟器…）
. scripts/pw-env.sh                 # 沙箱内无 root 运行 Playwright 所需环境
BASE=http://localhost:8088 /workspace/.venv/bin/python scripts/admin_shots.py chromium webkit   # 后台 390x844 / 1280x800 截图 + 溢出/控制台/点击目标≥44px 检查 → docs/screenshots/admin/
BASE=http://localhost:8088 /workspace/.venv/bin/python scripts/shots.py chromium                  # 前台页面检查 → shots/（已 .gitignore）
```
后台截图脚本需要后台管理员账号（默认演示账号，可用 `ADMIN_USER` / `ADMIN_PASS` 覆盖）。

## 部署
`Dockerfile` + `render.yaml`（Render 免费 Web 服务，`healthCheckPath: /api/health`）+ 中文 `DEPLOY.md`（含免费档休眠 / 冷启动 / 临时磁盘说明）。已部署在 Render：https://eightk-platform.onrender.com（公开 Git 仓库 Safeheron38y/my-dapp-project，main 推送后自动部署）。

## 文档
`API.md`（中文）· `openapi.yaml` · `DEPLOY.md`。HUIDU 集成见 `API.md` §15（环境变量 `HUIDU_BASE_URL/HUIDU_AGENCY_UID/HUIDU_AES_KEY`，未配置时自动使用本地模拟器；Docker/Render 默认 `HUIDU_SIMULATOR=on`）。**真实密钥只放环境变量（本地可用未提交的 `.env.local`），切勿提交。** 接真实 HUIDU：`HUIDU_MODE=live` + `HUIDU_SERVER_URL/HUIDU_AGENCY_UID/HUIDU_AES_KEY/HUIDU_PLAYER_PREFIX`，见 `DEPLOY.md` §6。
