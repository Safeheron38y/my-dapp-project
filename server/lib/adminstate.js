'use strict';
/**
 * 后台状态：管理员账号、站点设置（维护横幅等）、游戏运营覆盖（启停/热门/新游/排序/分类）、操作审计日志。
 * 持久化到 DATA_DIR/admin.json（原子写，见 lib/persist.js）。管理员与玩家账号完全分离（不同存储、不同会话、不同 Cookie）。
 */
const crypto = require('crypto');
const config = require('./config');
const persist = require('./persist');
const passwords = require('./passwords');

const DEFAULT_SETTINGS = () => ({
  maintenance: { enabled: false, text: '', level: 'info' }, // 站点横幅（前台所有页面顶部显示）
  blockPlay: false,           // 维护模式：true 时禁止启动游戏/投注（横幅同时显示）
  registrationOpen: true,     // 是否开放玩家注册
});
const MAX_AUDIT = 500;

const saved = persist.load('admin', {});
const admins = new Map(Object.entries(saved.admins || {}));   // usernameLower -> {id, username, pw, createdAt, lastLoginAt}
const settings = Object.assign(DEFAULT_SETTINGS(), saved.settings || {});
settings.maintenance = Object.assign(DEFAULT_SETTINGS().maintenance, settings.maintenance || {});
const overrides = Object.assign({}, saved.overrides || {});   // gameId -> {enabled?, hot?, new?, sort?, category?}
const audit = Array.isArray(saved.audit) ? saved.audit : [];

function snapshot() { return { v: 1, admins: Object.fromEntries(admins), settings, overrides, audit }; }
function dirty() { persist.schedule('admin', snapshot); }
persist.hookExit();

// ---- 游戏运营覆盖 ----
const BASE = new Map(); // gameId -> {category, tags, idx}
config.catalog.games.forEach((g, i) => BASE.set(g.id, { category: g.category, tags: (g.tags || []).slice(), idx: i + 1 }));
const hasTag = (tags, t) => tags.indexOf(t) >= 0;

function applyOne(g) {
  const b = BASE.get(g.id); if (!b) return;
  const o = overrides[g.id] || {};
  g.category = o.category && config.catalog.categories[o.category] ? o.category : b.category;
  const base = b.tags.filter((t) => t !== 'hot' && t !== 'new');
  const hot = o.hot != null ? !!o.hot : hasTag(b.tags, 'hot');
  const isNew = o.new != null ? !!o.new : hasTag(b.tags, 'new');
  g.tags = base.concat(hot ? ['hot'] : [], isNew ? ['new'] : []);
  g.enabled = o.enabled !== false;
  g.sort = o.sort != null ? Number(o.sort) : b.idx;
}
function applyAll() { for (const g of config.catalog.games) applyOne(g); }
applyAll();

function gameView(g) {
  const b = BASE.get(g.id) || {}, o = overrides[g.id] || {};
  const prov = config.providers[g.provider] || {};
  return { id: g.id, name: g.name, category: g.category, baseCategory: b.category, subcategory: g.subcategory || null, provider: g.provider, providerLabel: prov.label || g.provider, vendor: g.vendor || prov.label || g.provider,
    type: g.type, enabled: g.enabled !== false, hot: hasTag(g.tags, 'hot'), isNew: hasTag(g.tags, 'new'), sort: g.sort, baseSort: b.idx, customized: !!Object.keys(o).length, demo: !!g.demo };
}
function setOverride(id, patch) {
  const g = config.catalog.games.find((x) => x.id === id); if (!g) return null;
  const o = Object.assign({}, overrides[id] || {});
  if (patch.reset) delete overrides[id];
  else {
    if (patch.enabled != null) o.enabled = !!patch.enabled;
    if (patch.hot != null) o.hot = !!patch.hot;
    if (patch.isNew != null) o.new = !!patch.isNew;
    if (patch.sort != null) o.sort = Math.round(Number(patch.sort));
    if (patch.category != null) o.category = String(patch.category);
    overrides[id] = o;
  }
  applyOne(g); dirty();
  return g;
}

// ---- 设置 ----
function updateSettings(p) {
  if (p.maintenance && typeof p.maintenance === 'object') {
    const m = p.maintenance;
    if (m.enabled != null) settings.maintenance.enabled = !!m.enabled;
    if (m.text != null) settings.maintenance.text = String(m.text).slice(0, 200);
    if (m.level != null && ['info', 'warn'].includes(m.level)) settings.maintenance.level = m.level;
  }
  if (p.blockPlay != null) settings.blockPlay = !!p.blockPlay;
  if (p.registrationOpen != null) settings.registrationOpen = !!p.registrationOpen;
  dirty();
  return settings;
}
const publicMaintenance = () => ({ enabled: !!settings.maintenance.enabled, text: settings.maintenance.text, level: settings.maintenance.level, blockPlay: !!(settings.maintenance.enabled && settings.blockPlay) });

// ---- 管理员 ----
function upsertAdmin(username, password) {
  const k = username.toLowerCase();
  const ex = admins.get(k);
  const pw = passwords.hashSync(password);
  if (ex) { ex.pw = pw; ex.username = username; } else admins.set(k, { id: 'a_' + crypto.randomBytes(6).toString('hex'), username, pw, createdAt: Date.now(), lastLoginAt: null });
  dirty();
}
function getAdmin(username) { return admins.get(String(username || '').toLowerCase()) || null; }
// 种子：首次启动创建默认管理员；若设置了 ADMIN_USERNAME + ADMIN_PASSWORD 则每次启动以环境变量为准（可用于重置密码）。
function seedAdmin() {
  const envP = process.env.ADMIN_PASSWORD, envU = process.env.ADMIN_USERNAME || (envP ? 'admin' : '');
  if (envU && envP) { const ex = getAdmin(envU); if (!ex || process.env.ADMIN_PASSWORD_FORCE !== '0') upsertAdmin(envU, envP); return; }
  if (admins.size === 0) upsertAdmin('admin', 'Admin@2026!');
}
seedAdmin();

function log(adminName, action, target, detail) {
  audit.push({ t: Date.now(), admin: adminName, action, target: target || null, detail: detail || null });
  if (audit.length > MAX_AUDIT) audit.splice(0, audit.length - MAX_AUDIT);
  dirty();
}

module.exports = { admins, settings, overrides, audit, BASE, applyAll, applyOne, gameView, setOverride, updateSettings, publicMaintenance, upsertAdmin, getAdmin, log, dirty };
