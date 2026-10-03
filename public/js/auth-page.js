/* 登录 / 注册页（/login.html、/register.html）。成功后跳转 ?next=（仅允许站内路径），默认回大厅。 */
import { api, state, errText } from './api.js';

var mode = document.body.getAttribute('data-mode');
var q = new URLSearchParams(location.search);
var next = q.get('next');
// 登录/注册成功后：默认回大厅 /。只允许站内路径；登录页/注册页本身、以及已删除的旧页面(/games/*、live.html、sports.html)一律回大厅
if (!next || next.charAt(0) !== '/' || next.charAt(1) === '/' || next.indexOf('\\') >= 0 || /^\/(login|register)\.html/.test(next) || /^\/(games\/|live\.html|sports\.html)/.test(next)) next = '/';
var $ = function (s) { return document.querySelector(s); };
var msg = $('#msg'), go = $('#go');

function setMsg(t, ok) { msg.textContent = t || ''; msg.className = 'msg' + (ok ? ' ok' : ''); }
var suffix = '?next=' + encodeURIComponent(next);
if (mode === 'register') {
  $('#cw').hidden = false; $('#ph').hidden = false;
  $('#alt').innerHTML = '已有账号？<a href="/login.html' + suffix + '">去登录</a>';
} else {
  $('#alt').innerHTML = '还没有账号？<a href="/register.html' + suffix + '">立即注册</a>';
  if (q.get('frozen')) setMsg('账户已被冻结，请联系客服');
  // 演示账号快捷填充（密码同 README；仅演示环境）
  api.config().then(function (c) { if (c.demoLogin) $('#demo').hidden = false; }).catch(function () {});
  $('#demos').innerHTML = ['test01', 'test02', 'test03'].map(function (n) { return '<button type="button" data-u="' + n + '">' + n + '</button>'; }).join('') + '<br>密码：<b>Test@2026</b>';
  $('#demo').addEventListener('click', function (e) { var b = e.target.closest('[data-u]'); if (!b) return; $('#u').value = b.getAttribute('data-u'); $('#p').value = 'Test@2026'; $('#p').focus(); });
}
$('#sp').addEventListener('click', function () {
  var p = $('#p'), show = p.type === 'password'; p.type = show ? 'text' : 'password'; this.textContent = show ? '隐藏' : '显示'; this.setAttribute('aria-pressed', show ? 'true' : 'false'); this.setAttribute('aria-label', show ? '隐藏密码' : '显示密码');
});
$('#af').addEventListener('submit', function (e) {
  e.preventDefault(); setMsg('');
  var u = $('#u').value.trim(), p = $('#p').value;
  if (!u || !p) return setMsg('请输入用户名和密码');
  if (mode === 'register') {
    if (!/^[\w\u4e00-\u9fa5\-]{2,32}$/.test(u)) return setMsg('用户名需 2-32 位（字母、数字、汉字、_ -）');
    if (p.length < 8 || !/[A-Za-z]/.test(p) || !/\d/.test(p)) return setMsg('密码需 8-64 位，且同时包含字母和数字');
    if (p !== $('#p2').value) return setMsg('两次输入的密码不一致');
  }
  go.disabled = true;
  (mode === 'register' ? api.register(u, p) : api.login(u, p)).then(function () { setMsg('成功，正在跳转…', true); location.replace(next); })
    .catch(function (er) { setMsg(errText(er)); go.disabled = false; $('#p').focus(); });
});
// 已登录则直接跳转（?switch=1 时留在本页以便切换账号）
if (state.token && !q.get('switch') && !q.get('frozen')) api.ensure(true).then(function (r) { if (r) location.replace(next); });
$('#u').focus();
