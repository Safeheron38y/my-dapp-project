# 8K 游戏平台（演示 / Mock）
静态前端（原生 JS ES 模块，无构建、无 CDN）+ 零依赖 Node 20 Mock API。设计令牌取自 `../8k-home/index-v3-opt.html`（`public/css/tokens.css`）。

```
cd server && PORT=8088 node index.js     # 打开 http://localhost:8088
node server/test/run.js                  # 集成测试 45 项（含 HUIDU 加密/settle/别名/模拟器…）
node server/sim/huidu-sim.js             # 独立 HUIDU 模拟器（默认 :8090）
node server/scripts/huidu-sync.js        # 同步 HUIDU 游戏目录(无凭据则用模拟器)
/workspace/.venv/bin/python scripts/shots.py chromium webkit   # 截图 + 溢出/控制台/点击目标检查 → shots/（沙箱内先 `. scripts/pw-env.sh`）
```
文档：`API.md`（中文）· `openapi.yaml`。所有游戏/赔率/余额均为示例/演示。
HUIDU 集成：见 `API.md` §15（环境变量 `HUIDU_BASE_URL/HUIDU_AGENCY_UID/HUIDU_AES_KEY`，未配置时自动使用本地模拟器）。
