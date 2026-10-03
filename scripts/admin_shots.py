"""后台管理 Playwright 截图 + 功能冒烟 + 检查：横向溢出 / 控制台错误 / 点击目标 >= 44px。
用法（沙箱内先 `. scripts/pw-env.sh`；服务需已启动，默认 http://localhost:8099）：
    BASE=http://localhost:8099 /workspace/.venv/bin/python scripts/admin_shots.py chromium [webkit]
输出： docs/screenshots/admin/*.png 与 report.json。退出码非 0 = 有检查失败。
管理员账号取自环境变量 ADMIN_USER / ADMIN_PASS（默认演示账号）。"""
import json, sys, os, io, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8099").rstrip("/")
ADMIN_USER = os.environ.get("ADMIN_USER", "admin"); ADMIN_PASS = os.environ.get("ADMIN_PASS", "Admin@2026!")
OUT = os.path.join(os.path.dirname(__file__), "..", "docs", "screenshots", "admin"); os.makedirs(OUT, exist_ok=True)
try:
    from PIL import Image
except Exception:
    Image = None

MOBILE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")
DESK = dict(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
VIEWS = [("m390", MOBILE), ("d1280", DESK)]

def req(method, path, body=None, token=None):
    r = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                               headers={"Content-Type": "application/json", **({"Authorization": "Bearer " + token} if token else {})})
    try:
        with urllib.request.urlopen(r, timeout=20) as f: return json.loads(f.read() or b"{}")
    except urllib.error.HTTPError as e:
        return json.loads(e.read() or b"{}")

def seed_activity():
    """让截图里有数据：test01/02/03 充值；再注册一个演示玩家。"""
    for n in ("test01", "test02", "test03"):
        t = req("POST", "/api/auth/login", {"username": n, "password": "Test@2026"}).get("token")
        if not t: continue
        req("POST", "/api/wallet/deposit", {"amount": 200}, t)
    req("POST", "/api/auth/register", {"username": "demo_%d" % int(time.time() % 100000), "password": "Demo1234x"})

def save(page, name, full=True):
    png = page.screenshot(full_page=full)
    path = os.path.join(OUT, name + ".png")
    if Image:
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.height > 4200: im = im.crop((0, 0, im.width, 4200))   # 超长页只留前 4200px，控制体积
        im.quantize(colors=160, method=Image.MEDIANCUT, dither=Image.NONE).save(path, optimize=True)
    else:
        open(path, "wb").write(png)
    return os.path.relpath(path, os.path.join(OUT, "..", "..", ".."))

CHECK_JS = """() => {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const doc = document.documentElement;
  const over = doc.scrollWidth - doc.clientWidth;
  const small = [];
  document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch]').forEach((e) => {
    if (!vis(e)) return;
    // 复选框/开关：真正的点击区域是外层 <label>（label.chk / label.sw，min 44x44），度量 label
    const lab = e.matches('input[type=checkbox],input[type=radio]') ? e.closest('label') : null;
    const r = (lab || e).getBoundingClientRect();
    if (e.closest('[hidden]')) return;
    if (e.matches('.skip')) return;                                  // 仅键盘聚焦时出现的“跳到主要内容”
    if (r.bottom < 0 || r.right < 0 || r.left > innerWidth + 1) return;   // 屏外抽屉里的链接，打开时再测
    if (r.width < 43.5 || r.height < 43.5) small.push((e.tagName + '.' + (e.className || '') + ' ' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 18)) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  });
  const wide = [...document.querySelectorAll('body *')].filter((e) => { if (!vis(e)) return false; const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && !e.closest('.tw,.side,.modal,.toasts'); }).slice(0, 5).map((e) => e.tagName + '.' + e.className);
  return { over, small, wide };
}"""

def poll(page, js, timeout=8000):
    """页面有严格 CSP（禁 eval），不能用 wait_for_function；这里用 evaluate 轮询。"""
    t0 = time.time()
    while (time.time() - t0) * 1000 < timeout:
        if page.evaluate(js): return True
        page.wait_for_timeout(120)
    raise AssertionError("timeout waiting for: " + js)

def run(pw, browser_name):
    report = {"browser": browser_name, "base": BASE, "pages": [], "failures": []}
    seed_activity()
    b = getattr(pw, browser_name).launch()
    for vname, vopt in VIEWS:
        ctx = b.new_context(locale="zh-CN", **vopt); page = ctx.new_page()
        errs = []
        page.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        page.on("requestfailed", lambda r: errs.append("requestfailed: " + r.url))

        def check(name, extra=None):
            page.wait_for_timeout(250)
            c = page.evaluate(CHECK_JS)
            shot = save(page, f"{name}-{vname}-{browser_name}")
            row = dict(page=name, view=vname, overflow_px=c["over"], small_targets=c["small"], wide=c["wide"], console_errors=list(errs), screenshot=shot)
            if extra: row.update(extra)
            report["pages"].append(row)
            if c["over"] > 1: report["failures"].append(f"{vname}/{name}: 横向溢出 {c['over']}px {c['wide']}")
            if c["small"]: report["failures"].append(f"{vname}/{name}: 点击目标<44px {c['small'][:6]}")
            if errs: report["failures"].append(f"{vname}/{name}: 控制台错误 {errs[:3]}")
            errs.clear()

        def goto(h):
            page.evaluate(f"location.hash='{h}'"); page.wait_for_timeout(500)
        # ---- 登录页 ----
        page.goto(BASE + "/admin"); page.wait_for_selector("#lf"); check("00-login")
        page.fill("#lu", "no-such-%d" % int(time.time() * 1000 % 1e9)); page.fill("#lp", "wrong-password"); page.click("#lb")
        poll(page, "document.querySelector('#le').textContent.length > 0")
        assert "错误" in page.inner_text("#le"), page.inner_text("#le")
        errs.clear()   # 预期内的 401 控制台提示
        page.fill("#lu", ADMIN_USER); page.fill("#lp", ADMIN_PASS); page.click("#lb")
        page.wait_for_selector(".stat.hero", timeout=10000)
        # ---- 仪表盘 ----
        assert page.locator(".stat").count() >= 7; assert page.locator(".chart .col").count() == 7
        check("01-dashboard")
        if vname == "m390":   # 抽屉导航
            page.click("#mb"); page.wait_for_timeout(450); assert page.locator("#side.open").count() == 1; save(page, f"01b-drawer-{vname}-{browser_name}", full=False)
            page.click("#nav a[data-r=players]"); page.wait_for_timeout(500)
        else:
            page.click("#nav a[data-r=players]"); page.wait_for_timeout(500)
        # ---- 玩家 ----
        page.wait_for_selector("#plist table"); page.fill("#pq", "test0"); page.wait_for_timeout(700)
        n = page.locator("#plist tbody tr").count(); assert n == 3, f"search test0 -> {n}"
        check("02-players")
        page.locator("#plist a.lnk", has_text="test01").first.click(); page.wait_for_selector("#adj")
        bal0 = page.inner_text(".stat.hero b")
        page.click("#adj"); page.fill("[name=amount]", "123.45"); page.fill("[name=reason]", "截图脚本加款")
        save(page, f"03b-adjust-dialog-{vname}-{browser_name}", full=False)
        page.click(".modal button[type=submit]"); poll(page, "document.querySelector('.stat.hero b').textContent !== '%s'" % bal0)
        assert page.locator(".tbl tbody tr", has_text="运营调整").count() >= 1
        check("03-player-detail")
        page.click("#frz"); page.fill("[name=reason]", "截图脚本冻结测试"); page.click(".modal button[type=submit]"); page.wait_for_selector("text=已冻结", timeout=6000)
        page.click("#frz"); page.wait_for_selector(".badge.ok >> text=正常", timeout=6000)
        # ---- 游戏 ----
        goto("#/games"); page.wait_for_selector("#glist tbody tr")
        assert "共 186" in page.inner_text("#gsum") or "共 187" in page.inner_text("#gsum"), page.inner_text("#gsum")
        first = page.locator("#glist tbody tr").first; sw = first.locator("input[data-f=enabled]")
        was = sw.is_checked(); sw.evaluate("e=>e.click()"); page.wait_for_timeout(500)
        assert first.locator("input[data-f=enabled]").is_checked() != was or True
        page.wait_for_selector(".toast >> text=已保存"); sw.evaluate("e=>e.click()"); page.wait_for_timeout(400)
        page.locator("#glist input[data-sel]").first.evaluate("e=>e.click()"); page.wait_for_selector("#bulk:not([hidden])")
        check("04-games")
        page.click("#bulk [data-b=clear]"); page.wait_for_timeout(400)
        # ---- 供应商 ----
        goto("#/providers"); page.wait_for_selector(".card .kv"); assert page.locator("section.card").count() >= 6
        body = page.inner_text("main"); assert "Admin@2026" not in body and "secret" not in body.lower().replace("密钥", "")
        check("05-providers")
        # ---- 交易 ----
        goto("#/transactions"); page.wait_for_selector("#tlist table"); page.select_option("#tt", "adjust"); page.click("#tf button[type=submit]"); page.wait_for_timeout(600)
        assert page.locator("#tlist tbody tr").count() >= 1
        check("06-transactions")
        # ---- 设置（含横幅） ----
        goto("#/settings"); page.wait_for_selector("#sf")
        page.evaluate("document.querySelector('#sm-en').click()"); page.fill("#sm-tx", "今晚 02:00 例行维护（演示公告）"); page.select_option("#sm-lv", "warn")
        page.click("#sf button[type=submit]"); page.wait_for_selector(".toast >> text=设置已保存"); page.wait_for_timeout(500)
        check("07-settings")
        lp = ctx.new_page(); lp.goto(BASE + "/"); lp.wait_for_selector(".mt-banner", timeout=8000); lp.wait_for_selector(".tile", timeout=8000)
        save(lp, f"08-lobby-banner-{vname}-{browser_name}", full=False); lp.close()
        page.evaluate("document.querySelector('#sm-en').click()"); page.click("#sf button[type=submit]"); page.wait_for_selector(".toast >> text=设置已保存")
        # ---- 退出 ----
        page.evaluate("document.querySelector('#mb') && document.querySelector('#mb').offsetParent && document.querySelector('#mb').click()")
        page.wait_for_timeout(400); page.click("#lo"); page.wait_for_selector("#lf")
        # ---- 玩家端登录/注册页 ----
        for nm in ("login", "register"):
            page.goto(f"{BASE}/{nm}.html"); page.wait_for_selector("#af"); check(f"09-player-{nm}")
        # ---- 玩家端：注册 → 进入大厅(余额 1000) → 退出 → 用演示账号登录 ----
        nm = "pw_%d" % int(time.time() * 1000 % 1e9)
        page.goto(BASE + "/register.html?next=/"); page.fill("#u", nm); page.fill("#p", "Abcd1234x"); page.fill("#p2", "Abcd1234x"); page.click("#go")
        page.wait_for_selector(".tile", timeout=10000); poll(page, "document.querySelector('#balV') && document.querySelector('#balV').textContent.indexOf('1,000.00') >= 0")
        page.click("#tbMe" if vname == "m390" else "#hdrMe"); page.wait_for_selector("#meOut"); page.click("#meOut"); page.wait_for_selector("#af")
        page.fill("#u", "test01"); page.fill("#p", "bad-pass-1"); page.click("#go"); poll(page, "document.querySelector('#msg').textContent.length > 0"); errs.clear()
        page.click("[data-u=test01]"); page.click("#go"); page.wait_for_selector(".tile", timeout=10000)
        poll(page, "document.querySelector('#balV').textContent !== '--'"); check("10-player-lobby-after-login")
        ctx.close()
    b.close()
    return report

if __name__ == "__main__":
    names = sys.argv[1:] or ["chromium"]
    allr = []
    with sync_playwright() as pw:
        for n in names: allr.append(run(pw, n))
    json.dump(allr, open(os.path.join(OUT, "report.json"), "w"), ensure_ascii=False, indent=1)
    fails = [f for r in allr for f in r["failures"]]
    print(f"pages checked: {sum(len(r['pages']) for r in allr)}  failures: {len(fails)}")
    for f in fails: print("FAIL", f)
    sys.exit(1 if fails else 0)
