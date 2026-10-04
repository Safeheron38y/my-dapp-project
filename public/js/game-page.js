/* 通用“供应商 iframe 游戏”页：/game.html?id=<gameId>。 launch → iframe + postMessage 桥 */
import { api, state, errText } from './api.js';
import { GameWindow } from './gamewindow.js';
import { toast } from './ui.js';

var id = new URLSearchParams(location.search).get('id');
var gw = new GameWindow({ title: '加载中…', orientation: 'any' });
function start() {
  gw.showLoading('正在登录…');
  return api.ensure().then(function () {
    return api.get('/api/games/' + encodeURIComponent(id));
  }).then(function (r) {
    var g = r.game;
    document.title = g.name + '｜8K（演示）';
    gw.opt.title = g.name;
    gw.opt.orientation = g.orientation; gw.opt.provider = g.providerLabel;
    gw.checkOrientation();
    return gw.loadIframe(function () {
      return api.launch(id).then(function (l) {
        return l;
      });
    });
  }).catch(function (e) { if (e.code || e.status === 0) gw.showError(errText(e)); else if (e.message !== '跳转中…') gw.showError(e.message); });
}
gw.opt.onReconnect = start;
if (!id) gw.showError('缺少游戏 ID', false); else start();
