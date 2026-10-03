(function () {
  var qs = new URLSearchParams(location.search), token = qs.get('token');
  var host = window.parent, hostOrigin = location.origin; // 同源演示；真实供应商应校验宿主 origin 白名单
  function send(type, payload, id) { host.postMessage({ source: '8k', v: 1, type: type, id: id, payload: payload }, hostOrigin); }
  var $ = function (s) { return document.querySelector(s); };
  var busy = false, muted = false;
  window.addEventListener('message', function (e) {
    if (e.source !== host || e.origin !== hostOrigin) return;
    var d = e.data; if (!d || d.source !== '8k') return;
    if (d.type === 'init') { muted = !!d.payload.muted; }
    if (d.type === 'sound') muted = !!d.payload.muted;
  });
  send('ready', { game: qs.get('game') });
  function amt() { var v = parseFloat($('#amt').value); return isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : 0; }
  $('#m').onclick = function () { $('#amt').value = Math.max(1, amt() - 1); };
  $('#p').onclick = function () { $('#amt').value = amt() + 1; };
  $('#spin').onclick = function () {
    if (busy) return; var a = amt(); if (!a) { $('#res').textContent = '请输入有效金额'; return; }
    busy = true; $('#spin').disabled = true; $('#res').textContent = '';
    var reels = document.querySelectorAll('.reel'); reels.forEach(function (r) { r.classList.add('sp'); });
    send('roundStart', {});
    fetch('/api/mock/provider-spin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token, amount: a }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (r) {
        setTimeout(function () {
          reels.forEach(function (x, i) { x.classList.remove('sp'); if (r.ok) x.textContent = r.j.reels[i]; });
          $('#res').textContent = r.ok ? (r.j.win > 0 ? '中奖 +' + r.j.win.toFixed(2) + '（演示币）' : '未中奖') : (r.j.message || '失败');
          send('roundEnd', r.ok ? { win: r.j.win, balance: r.j.balance } : { error: r.j.code });
          busy = false; $('#spin').disabled = false;
        }, 700);
      }).catch(function () { reels.forEach(function (x) { x.classList.remove('sp'); }); $('#res').textContent = '网络错误'; send('error', { message: '网络错误' }); busy = false; $('#spin').disabled = false; });
  };
})();
