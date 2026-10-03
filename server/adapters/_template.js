'use strict';
/**
 * ============================================================
 *  供应商适配器模板 (Provider Adapter Template)
 * ============================================================
 * 新增供应商步骤：
 *   1. 复制本文件为 adapters/<名称>.js（如 pragmatic.js），按供应商文档实现下列方法。
 *   2. 在 config/providers.json 增加一项：{ "adapter": "<名称>", "enabled": true, "baseUrl": "${X_BASE_URL}", "apiKey": "${X_API_KEY}", "secret": "${X_SECRET}", ... }
 *      并在部署环境设置对应环境变量（不要把真实密钥写进仓库）。
 *   3. 实现 listGames()，或把供应商游戏手工写入 config/games.json（provider 字段 = providers.json 的键）。
 *   4. 供应商后台里把回调地址配置为：  https://<你的域名>/provider/<providers.json 的键>/{balance|bet|win|rollback|refund}
 *   5. 运行 `npm test` 并用供应商沙箱走通：登录/启动 → 下注 → 派彩 → 冲正 → 重复请求(幂等)。
 *
 * 钱包核心 (lib/wallet.js) 统一处理余额、幂等、冲正、限额，适配器只负责“翻译”：
 *   - 把供应商的请求字段翻译成统一结构（parseCallback）
 *   - 把统一结果翻译成供应商要求的响应格式（formatResponse / formatError）
 *   - 启动游戏时生成启动 URL（launch）
 *   - 验证供应商回调签名（verifyCallback）
 *
 * 所有方法都可以是 async。未实现的可选方法保持默认即可。
 */

class TemplateAdapter {
  /** @param {object} cfg providers.json 中该供应商的配置（已完成环境变量替换） @param {string} name 供应商键名 */
  constructor(cfg, name) { this.cfg = cfg; this.name = name; }

  /** 钱包模式：'shared' = 共享钱包(Seamless，供应商每次下注回调我们)；'transfer' = 转账钱包(额度转入/转出供应商) */
  get walletMode() { return this.cfg.walletMode || 'shared'; }

  /**
   * (可选) 拉取供应商游戏列表，返回统一结构数组：
   * [{ id, name, category: 'live|slots|table|crash|sports', subcategory, provider: this.name, type: 'iframe|live|inhouse|sports',
   *    orientation: 'any|landscape|portrait', tags: [], thumb?: '', providerGameId }]
   * 返回 null 表示使用 config/games.json 中的静态目录。
   */
  async listGames() { return null; }

  /**
   * 启动游戏：返回让前端 iframe 打开的地址。
   * @param {{user:{id,username,region}, game:object, device:'mobile'|'desktop', lang:string, currency:string,
   *          launchToken:string, returnUrl:string, callbackBase:string, demo:boolean}} ctx
   * @returns {Promise<{url:string, method?:'GET'|'POST', fields?:object, expiresIn?:number, mode:'real'|'demo'}>}
   * 提示：共享钱包下，通常把 launchToken 或 user.id 作为供应商的 player/session 标识传过去；
   *       供应商回调时再把它回传，我们在 parseCallback 里解析出 userId。
   */
  async launch(ctx) {
    // TODO: 调用供应商的 “创建会话/获取游戏链接” API，例如：
    // const r = await fetch(`${this.cfg.baseUrl}/v1/game/url`, { method:'POST', headers:{ 'X-Api-Key': this.cfg.apiKey, 'Content-Type':'application/json' },
    //   body: JSON.stringify({ player: ctx.user.id, game: ctx.game.providerGameId || ctx.game.id, lang: ctx.lang, currency: ctx.currency, returnUrl: ctx.returnUrl }) });
    // const j = await r.json(); return { url: j.url, mode: 'real', expiresIn: 3600 };
    throw new Error(`[${this.name}] launch() 未实现`);
  }

  /**
   * 校验回调签名。务必使用时间安全比较与时间戳窗口，防重放。
   * @param {{headers:object, rawBody:string, query:object, action:string, ip:string}} req  rawBody 是未经解析的原始请求体字符串（签名必须基于原始字节）
   * @returns {{ok:boolean, reason?:string}}
   * 默认：使用 lib/sign.js 的占位方案 HMAC-SHA256(secret, `${X-Timestamp}.${rawBody}`)。真实供应商请按其文档改写。
   */
  verifyCallback(req) {
    const { verify } = require('../lib/sign');
    return verify({ secret: this.cfg.secret, timestamp: req.headers['x-timestamp'], signature: req.headers['x-signature'], rawBody: req.rawBody });
  }

  /**
   * 把供应商回调翻译成统一结构。
   * @param {'balance'|'bet'|'win'|'rollback'|'refund'} action
   * @param {{body:object, query:object, headers:object}} req
   * @returns {{userId:string, txId?:string, amount?:number（主币单位，最多2位小数）, roundId?:string, gameId?:string, refTxId?:string, category?:string}}
   * 默认假定供应商发送的就是统一字段（见 API.md）。
   */
  parseCallback(action, req) {
    const b = req.body || {};
    return { userId: b.userId || b.playerId, txId: b.txId || b.transactionId, amount: b.amount, roundId: b.roundId, gameId: b.gameId, refTxId: b.refTxId || b.originalTxId, category: b.category };
  }

  /** 把统一结果翻译成供应商要求的成功响应。result = { balance, duplicate, txId, ... } */
  formatResponse(action, result) { return { status: 200, body: Object.assign({ ok: true }, result) }; }

  /** 把统一错误翻译成供应商要求的错误响应。err = { code, message, http, extra } */
  formatError(action, err) { return { status: err.http || 400, body: { ok: false, code: err.code, message: err.message } }; }

  // ---------- 仅 转账钱包(transfer) 需要 ----------
  /** 把额度转入供应商钱包。返回 { providerBalance } */
  async transferIn(/* { user, amountMinor, txId } */) { throw new Error('transferIn() 未实现'); }
  /** 从供应商钱包转出（通常在退出游戏时调用）。返回 { amountMinor } */
  async transferOut(/* { user, amountMinor, txId } */) { throw new Error('transferOut() 未实现'); }
  /** 查询供应商钱包余额(分) */
  async queryBalance(/* { user } */) { throw new Error('queryBalance() 未实现'); }
}

module.exports = TemplateAdapter;
