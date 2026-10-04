'use strict';
/**
 * 环境变量装载与别名归一（零依赖，必须在 lib/config.js 的 ${VAR} 替换之前执行）。
 *
 * 1) 本地开发：若存在 <repo>/.env.local（已在 .gitignore，永不提交，且 .dockerignore 排除）则读入 process.env，
 *    已存在的真实环境变量优先、不会被覆盖。ENV_LOCAL=off 或 ENV_FILE=off 关闭（测试用）；ENV_FILE=<path> 指定其他文件。
 *    部署（Render）不使用该文件——在托管平台 Environment 里设置同名变量。
 * 2) HUIDU 友好别名：
 *      HUIDU_SERVER_URL     → HUIDU_BASE_URL      （HUIDU 给的 server_url）
 *      HUIDU_PLAYER_PREFIX  → HUIDU_ALIAS_PREFIX  （HUIDU 给的 player_prefix；member_account 必须以它开头，否则 10022）
 *    （原名优先；别名仅在原名未设置时生效）
 * 3) HUIDU_MODE：
 *      live          真实 HUIDU（HUIDU_SIMULATOR=off；凭据不全 → 启动游戏报 PROVIDER_NOT_CONFIGURED，绝不静默回退到模拟器）
 *      sim|simulator|demo  内置模拟器（HUIDU_SIMULATOR=on）
 *      未设置        保持旧行为：HUIDU_SIMULATOR 有值按其值；也未设置则默认模拟器(on)——即使凭据已就位也不会误连真实环境。
 *    HUIDU_MODE 优先于 HUIDU_SIMULATOR。
 * 本模块绝不打印任何变量的值。
 */
const fs = require('fs');
const path = require('path');

function parse(text) {
  const out = {};
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    let v = m[2];
    if ((v[0] === '"' && v.endsWith('"') && v.length > 1) || (v[0] === "'" && v.endsWith("'") && v.length > 1)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out[m[1]] = v;
  }
  return out;
}
function loadFile(file, env) {
  const loaded = [];
  if (!file || /^off$/i.test(file) || !fs.existsSync(file)) return loaded;
  const kv = parse(fs.readFileSync(file, 'utf8'));
  for (const [k, v] of Object.entries(kv)) if (env[k] === undefined) { env[k] = v; loaded.push(k); }
  return loaded;
}
function normalize(env) {
  if (!env.HUIDU_BASE_URL && env.HUIDU_SERVER_URL) env.HUIDU_BASE_URL = env.HUIDU_SERVER_URL;
  if (!env.HUIDU_ALIAS_PREFIX && env.HUIDU_PLAYER_PREFIX) env.HUIDU_ALIAS_PREFIX = env.HUIDU_PLAYER_PREFIX;
  const mode = String(env.HUIDU_MODE || '').trim().toLowerCase();
  if (mode === 'live' || mode === 'real' || mode === 'prod') env.HUIDU_SIMULATOR = 'off';
  else if (mode === 'sim' || mode === 'simulator' || mode === 'demo') env.HUIDU_SIMULATOR = 'on';
  else if (!env.HUIDU_SIMULATOR) env.HUIDU_SIMULATOR = 'on';
  return env;
}
function init(env) {
  env = env || process.env;
  const root = path.join(__dirname, '..', '..');
  const file = env.ENV_FILE !== undefined ? env.ENV_FILE : (/^off$/i.test(env.ENV_LOCAL || '') ? 'off' : path.join(root, '.env.local'));
  const loaded = loadFile(file, env);
  normalize(env);
  return loaded;
}
module.exports = { init, parse, normalize, loadFile };
module.exports.loaded = init();
