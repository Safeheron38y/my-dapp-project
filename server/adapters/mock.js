'use strict';
/**
 * Mock 适配器：模拟一个“共享钱包 / 转账钱包”供应商。仅用于开发与演示。
 * 启动 URL 指向本地 /demo/provider-game.html（一个会通过 postMessage 与宿主通信的演示 iframe 游戏）。
 */
const Base = require('./_template');
const wallet = require('../lib/wallet');

class MockAdapter extends Base {
  async launch(ctx) {
    const q = new URLSearchParams({ token: ctx.launchToken, game: ctx.game.id, provider: this.name, mode: this.walletMode, lang: ctx.lang });
    return { url: `${ctx.publicBase || ''}/demo/provider-game.html?${q}`, method: 'GET', expiresIn: 3600, mode: 'demo' };
  }
  // 转账钱包 mock：以内存模拟
  async transferIn({ user, amountMinor, txId }) {
    const r = wallet.transfer({ provider: this.name, userId: user.id, direction: 'in', amountMinor, txId });
    return { providerBalance: r.providerBalance, balance: r.balance };
  }
  async transferOut({ user, amountMinor, txId }) {
    const amt = amountMinor == null ? wallet.providerBalance(this.name, user.id) : amountMinor;
    if (amt <= 0) return { amountMinor: 0 };
    const r = wallet.transfer({ provider: this.name, userId: user.id, direction: 'out', amountMinor: amt, txId });
    return { amountMinor: amt, balance: r.balance };
  }
  async queryBalance({ user }) { return { amountMinor: wallet.providerBalance(this.name, user.id) }; }
}
module.exports = MockAdapter;
