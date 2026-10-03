'use strict';
const path = require('path');
const fs = require('fs');
const config = require('../lib/config');

const instances = {};
for (const [name, cfg] of Object.entries(config.providers)) {
  if (!cfg.enabled) continue;
  const file = path.join(__dirname, cfg.adapter + '.js');
  if (!fs.existsSync(file)) { console.warn(`[adapters] ${name}: 找不到适配器 ${cfg.adapter}.js，已跳过`); continue; }
  const Adapter = require(file);
  instances[name] = new Adapter(cfg, name);
}
// 测试/动态场景：运行期注册一个适配器实例（同时写入 config.providers，供回调路由读取配置）
function register(name, cfg) {
  const Adapter = require(path.join(__dirname, cfg.adapter + '.js'));
  config.providers[name] = cfg; instances[name] = new Adapter(cfg, name);
  return instances[name];
}
module.exports = {
  register,
  get: (name) => instances[name] || null,
  all: () => instances,
  names: () => Object.keys(instances),
};
