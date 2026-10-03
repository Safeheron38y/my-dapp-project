'use strict';
/**
 * JSON 文件持久化（零依赖）。目录由环境变量 DATA_DIR 指定（默认 <项目根>/data；设为 off / memory / :memory: 则关闭持久化）。
 *  - 原子写：先写 <file>.<pid>.tmp → fsync → rename 覆盖（同一文件系统内 rename 是原子的），再 fsync 目录；崩溃/断电不会留下半截文件。
 *  - 读到损坏的 JSON：把坏文件改名为 <file>.corrupt-<ts> 并以默认值启动，不会让服务起不来。
 *  - 防抖：schedule(name, fn) 合并高频写（默认 1.5s），进程退出/收到 SIGTERM 时 flushAll() 同步落盘。
 * 注意：免费托管（如 Render Free）的磁盘是临时的，重启/重新部署后 DATA_DIR 里的数据会丢失；需要真正持久请挂载持久盘或换数据库（见 DEPLOY.md）。
 */
const fs = require('fs');
const path = require('path');

const raw = process.env.DATA_DIR;
const OFF = raw != null && /^(off|memory|:memory:|none|0)$/i.test(raw.trim());
const DIR = OFF ? null : path.resolve(raw && raw.trim() ? raw.trim() : path.join(__dirname, '..', '..', 'data'));
const DELAY = process.env.PERSIST_DELAY_MS !== undefined && Number.isFinite(+process.env.PERSIST_DELAY_MS) ? +process.env.PERSIST_DELAY_MS : 1500;

const enabled = () => !!DIR;
const fileOf = (name) => path.join(DIR, name + '.json');

function ensureDir() { fs.mkdirSync(DIR, { recursive: true, mode: 0o700 }); }

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const fd = fs.openSync(tmp, 'w', 0o600);
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, file);
  try { const dfd = fs.openSync(path.dirname(file), 'r'); try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); } } catch { /* Windows 等不支持目录 fsync */ }
}

function load(name, fallback) {
  if (!DIR) return fallback;
  const f = fileOf(name);
  let txt;
  try { txt = fs.readFileSync(f, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
  try { return JSON.parse(txt); } catch (e) {
    const bad = `${f}.corrupt-${Date.now()}`;
    try { fs.renameSync(f, bad); } catch { /* ignore */ }
    console.error(`[persist] ${name}.json 已损坏，已改名为 ${path.basename(bad)}，使用默认值启动`);
    return fallback;
  }
}

function saveNow(name, data) {
  if (!DIR) return false;
  ensureDir();
  writeAtomic(fileOf(name), JSON.stringify(data));
  return true;
}

const pending = new Map(); // name -> {fn, timer}
function schedule(name, fn) {
  if (!DIR) return;
  const p = pending.get(name);
  if (p) { p.fn = fn; return; }
  const timer = setTimeout(() => flush(name), DELAY);
  if (timer.unref) timer.unref();
  pending.set(name, { fn, timer });
}
function flush(name) {
  const p = pending.get(name);
  if (!p) return;
  pending.delete(name); clearTimeout(p.timer);
  try { saveNow(name, p.fn()); } catch (e) { console.error(`[persist] 写入 ${name}.json 失败:`, e.message); }
}
function flushAll() { for (const name of [...pending.keys()]) flush(name); }

let hooked = false;
function hookExit() {
  if (hooked || !DIR) return; hooked = true;
  process.on('exit', flushAll);
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { flushAll(); process.exit(0); });
}

module.exports = { enabled, dir: () => DIR, load, saveNow, schedule, flush, flushAll, hookExit };
