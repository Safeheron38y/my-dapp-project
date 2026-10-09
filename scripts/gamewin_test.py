"""游戏窗口沉浸式布局测试 (Playwright: Chromium + WebKit; 390x844 与 844x390)。
用法: BASE=http://localhost:8101 python scripts/gamewin_test.py   （需要已启动的服务，HUIDU 模拟器模式）
断言：iframe 矩形 == 视口；无顶栏/无空隙(多点 elementFromPoint + 截图无桃色像素)；html/body 黑底且不可滚动；
返回钮：左上角、半透明圆形、3 秒后变淡、轻触唤回、再点返回(history.back / 兜底 '/')；返回钮之外的点击能到达游戏。截图 → shots/gamewin-*.png"""
import json, os, sys, urllib.request, uuid, io
from playwright.sync_api import sync_playwright
from PIL import Image

BASE = os.environ.get("BASE", "http://localhost:8088")
OUT = os.path.join(os.path.dirname(__file__), "..", "shots"); os.makedirs(OUT, exist_ok=True)
UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
SIZES = [("iPhoneSE-375x667", 375, 667, "ios"), ("iPhone12-390x844", 390, 844, "ios"), ("iPhoneProMax-430x932", 430, 932, "ios"),
         ("Android-360x640", 360, 640, "android"), ("Android-360x740", 360, 740, "android"), ("AndroidTall-412x915", 412, 915, "android"),
         ("Fold-344x882", 344, 882, "android"), ("iPad-768x1024", 768, 1024, "ios")]
VIEWS = {}
for n, w, h, k in SIZES:
    VIEWS[n + "-portrait"] = (w, h, k); VIEWS[n + "-landscape"] = (h, w, k)
EXTRA = ("iPhone12-390x844", "iPad-768x1024")  # 这些尺寸额外测：直接打开兜底 / 离线横幅 / 刘海安全区 / 地址栏收起
UA_AND = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36"
GAME = "/game.html?id=pg-mahjong-ways"

def token():
    r = urllib.request.Request(BASE + "/api/auth/register", data=json.dumps({"username": "gw_" + uuid.uuid4().hex[:8], "password": "Shots1234x"}).encode(), headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(r, timeout=20).read())["token"]

M = """() => { const r = s => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left, y: b.top, w: b.width, h: b.height}; };
  const de = document.documentElement;
  return { vw: innerWidth, vh: innerHeight, iframe: r('.gw-body iframe'), gw: r('.gw'), back: r('#gwBack'), circle: r('#gwBack>span'), top: r('.gw-top'), bar: r('.gw-bar'),
    sh: de.scrollHeight, sw: de.scrollWidth, bsh: document.body.scrollHeight, htmlBg: getComputedStyle(de).backgroundColor, bodyBg: getComputedStyle(document.body).backgroundColor,
    ifBg: getComputedStyle(document.querySelector('.gw-body iframe')).backgroundColor, gwH: getComputedStyle(document.querySelector('.gw')).height,
    backOpacity: parseFloat(getComputedStyle(document.querySelector('#gwBack')).opacity), backDim: document.querySelector('#gwBack').classList.contains('dim'),
    circleBg: getComputedStyle(document.querySelector('#gwBack>span')).backgroundColor, circleRadius: getComputedStyle(document.querySelector('#gwBack>span')).borderRadius,
    vf: (document.querySelector('meta[name=viewport]').content.indexOf('viewport-fit=cover') >= 0) }; }"""
HIT = "([x,y]) => { const e = document.elementFromPoint(x,y); return e ? (e.tagName + (e.id ? '#' + e.id : '') + '|' + (e.closest('#gwBack') ? 'back' : (e.tagName === 'IFRAME' ? 'iframe' : 'other'))) : null; }"
fails = []; log = []
def check(ok, msg):
    log.append(("OK   " if ok else "FAIL ") + msg)
    if os.environ.get("VERBOSE"): print(log[-1], flush=True)
    if not ok: fails.append(msg)
def near(a, b, t=0.6): return abs(a - b) <= t

def run(pw, eng):
    br = getattr(pw, eng).launch()
    for vn, (W, H, kind) in VIEWS.items():
        tag = f"{eng}/{vn}"
        ctx = br.new_context(viewport={"width": W, "height": H}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=UA if kind == "ios" else UA_AND, locale="zh-CN")
        ctx.add_init_script("try{localStorage.setItem('8k.token','%s')}catch(e){}" % token())
        p = ctx.new_page(); errs = []
        p.on("pageerror", lambda e: errs.append(str(e)))
        # 1) 从首页进入游戏（保证有历史记录）
        p.goto(BASE + "/"); p.wait_for_selector(".tile", timeout=15000)
        link = 'a[href*="pg-mahjong-ways"]'
        p.wait_for_selector(link, state="attached"); p.evaluate("s => document.querySelector(s).click()", link); p.wait_for_url("**/game.html*", timeout=15000); fr = p.frame_locator("iframe"); fr.locator("#spin").wait_for(timeout=15000); p.wait_for_timeout(300)
        m = p.evaluate(M)
        i = m["iframe"]
        check(i and near(i["x"], 0) and near(i["y"], 0) and near(i["w"], m["vw"]) and near(i["h"], m["vh"]), f"{tag} iframe rect {i} == viewport {m['vw']}x{m['vh']}")
        check(m["gw"] and near(m["gw"]["h"], m["vh"]) and near(m["gw"]["w"], m["vw"]), f"{tag} .gw == viewport")
        check(m["top"] is None, f"{tag} no purple header (.gw-top absent)")
        check(m["bar"] is None or m["bar"]["h"] == 0, f"{tag} offline banner hidden (no peach strip) bar={m['bar']}")
        check(m["sh"] <= m["vh"] and m["sw"] <= m["vw"] and m["bsh"] <= m["vh"], f"{tag} no document overflow sh={m['sh']} sw={m['sw']}")
        check(m["htmlBg"] == "rgb(0, 0, 0)" and m["bodyBg"] == "rgb(0, 0, 0)" and m["ifBg"] == "rgb(0, 0, 0)", f"{tag} html/body/iframe bg black ({m['htmlBg']},{m['bodyBg']},{m['ifBg']})")
        check(m["vf"], f"{tag} viewport-fit=cover")
        # 多点命中测试：四边/四角/各边中点都应落在 iframe（返回钮区域除外）
        pts = [(W / 2, 1), (W / 2, H - 1), (1, H / 2), (W - 1, H / 2), (W - 1, 1), (W - 1, H - 1), (1, H - 1), (W / 2, 70), (W / 2, 57)]
        hits = [p.evaluate(HIT, [x, y]) for x, y in pts]
        check(all(h and h.endswith("iframe") for h in hits), f"{tag} edge points hit iframe {hits}")
        # 无法滚动 / 回弹
        p.evaluate("window.scrollTo(0, 500)"); 
        try: p.mouse.wheel(0, 400)
        except Exception: pass  # 移动端 WebKit 不支持 wheel
        p.wait_for_timeout(100)
        check(p.evaluate("[scrollY, scrollX]") == [0, 0], f"{tag} body does not scroll")
        # 截图 + 桃色像素检查（#ff9a76 / #F7D3C4 等）
        shot = os.path.join(OUT, f"gamewin-{eng}-{vn}.png"); png = p.screenshot(path=shot, scale="css")
        im = Image.open(io.BytesIO(png)).convert("RGB"); w, h = im.size
        peach = 0
        isp = lambda px: px[0] > 200 and 120 < px[1] < 225 and 90 < px[2] < 205 and px[0] - px[2] > 40
        for y in range(h):  # 全宽条带：最左/最右像素都是桃色(游戏自身的按钮不会贴边)
            if isp(im.getpixel((1, y))) and isp(im.getpixel((w - 2, y))): peach += 1
        check(peach == 0, f"{tag} no peach strip rows in screenshot (rows={peach})")
        # 返回钮
        b = m["back"]; c = m["circle"]
        check(b and b["x"] < 20 and b["y"] < 20 and b["w"] >= 44 and b["h"] >= 44 and c["w"] <= 40, f"{tag} back button top-left, hit>=44px, circle {c and c['w']}px")
        check(m["circleBg"].startswith("rgba(") and 0 < float(m["circleBg"].rstrip(")").split(",")[-1]) < 1, f"{tag} back circle semi-transparent {m['circleBg']}")
        check(m["circleRadius"] in ("50%", "18px") or float(m["circleRadius"].rstrip('px%') or 0) >= 18, f"{tag} back circle round ({m['circleRadius']})")
        # 返回钮之外点击到达游戏
        fr.locator("#spin").click(); p.wait_for_timeout(1200)
        check(fr.locator("#res").inner_text() != "", f"{tag} game click works (spin result)")
        x0, y0 = b["x"] + b["w"] + 4, b["y"] + b["h"] / 2
        check(p.evaluate(HIT, [x0, y0]).endswith("iframe"), f"{tag} point right of back hit-area reaches iframe")
        # 自动变淡
        p.wait_for_timeout(3300); m2 = p.evaluate(M)
        check(m2["backDim"] and m2["backOpacity"] < 0.5, f"{tag} back dims after 3s (opacity {m2['backOpacity']})")
        if vn.startswith(EXTRA): p.screenshot(path=os.path.join(OUT, f"gamewin-{eng}-{vn}-dim.png"))
        # 变淡时轻触 → 唤回（不返回）
        cx, cy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
        p.touchscreen.tap(cx, cy); p.wait_for_timeout(500)
        m3 = p.evaluate(M)
        check(p.url.endswith(GAME) and not m3["backDim"] and m3["backOpacity"] > 0.9, f"{tag} tap near top-left wakes button, stays on page (opacity {m3['backOpacity']})")
        # 再点 → 返回上一页 '/'
        p.touchscreen.tap(cx, cy); p.wait_for_url(BASE + "/", timeout=8000)
        check(p.url.rstrip("/") == BASE.rstrip("/"), f"{tag} back -> {p.url}")
        if not vn.startswith(EXTRA): ctx.close(); check(not errs, f"{tag} no page errors {errs}"); continue
        # 2) 直接打开（无历史）→ 兜底到 '/'
        q = ctx.new_page(); q.goto(BASE + GAME); q.frame_locator("iframe").locator("#spin").wait_for(timeout=15000)
        q.click("#gwBack"); q.wait_for_url(BASE + "/", timeout=8000)
        check(q.url.rstrip("/") == BASE.rstrip("/"), f"{tag} direct-open back falls back to / ({q.url})")
        # 3) 离线横幅出现时不占位
        r = ctx.new_page(); r.goto(BASE + GAME); r.frame_locator("iframe").locator("#spin").wait_for(timeout=15000)
        r.evaluate("window.dispatchEvent(new Event('offline'))"); r.wait_for_timeout(300)
        mb = r.evaluate(M); ib = mb["iframe"]
        check(mb["bar"] and mb["bar"]["h"] > 0 and near(ib["y"], 0) and near(ib["h"], mb["vh"]), f"{tag} offline banner floats, iframe still full")
        r.screenshot(path=os.path.join(OUT, f"gamewin-{eng}-{vn}-offline.png"))
        # 4) 刘海/灵动岛/Home 条安全区(用 CSS 变量模拟 env())：iframe 仍铺满，返回钮避开刘海
        n = ctx.new_page(); n.goto(BASE + GAME); n.frame_locator("iframe").locator("#spin").wait_for(timeout=15000)
        n.add_style_tag(content=":root{--sat:47px;--sab:34px;--sal:47px;--sar:47px}"); n.wait_for_timeout(200)
        mn = n.evaluate(M); ib = mn["iframe"]
        check(near(ib["x"], 0) and near(ib["y"], 0) and near(ib["w"], mn["vw"]) and near(ib["h"], mn["vh"]), f"{tag} safe-area simulated: iframe still == viewport")
        check(mn["back"]["y"] >= 47 and mn["back"]["x"] >= 47, f"{tag} safe-area simulated: back button inset ({mn['back']['x']},{mn['back']['y']})")
        n.screenshot(path=os.path.join(OUT, f"gamewin-{eng}-{vn}-notch.png"))
        # 5) 地址栏收起/展开：视口高度变化后 iframe 跟随
        for dh in (56, -40):
            n.set_viewport_size({"width": W, "height": H + dh}); n.wait_for_timeout(300)
            mm = n.evaluate(M); ib = mm["iframe"]
            check(near(ib["y"], 0) and near(ib["h"], mm["vh"]) and near(ib["w"], mm["vw"]) and mm["sh"] <= mm["vh"], f"{tag} viewport {W}x{H+dh} (address bar): iframe h={ib['h']} vh={mm['vh']}")
        check(not errs, f"{tag} no page errors {errs}")
        ctx.close()
    br.close()

with sync_playwright() as pw:
    for eng in (sys.argv[1:] or ["chromium", "webkit"]): run(pw, eng)
print("\n".join(log))
tags = {}
for l in log:
    t = l.split()[1]; tags.setdefault(t, []).append(l.startswith("OK"))
print("\n== per size ==")
for t, v in tags.items(): print(f"{'PASS' if all(v) else 'FAIL'} {t} ({sum(v)}/{len(v)})")
print(f"\n{len(log) - len(fails)}/{len(log)} passed")
sys.exit(1 if fails else 0)
