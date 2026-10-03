"""Playwright 截图 + 检查：溢出 / 控制台错误 / 点击目标 >= 44px。输出 ../shots/*.png 与 ../shots/report.json"""
import json, sys, os, time
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8088")
OUT = os.path.join(os.path.dirname(__file__), "..", "shots")
os.makedirs(OUT, exist_ok=True)

MOBILE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
              user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")
DESK = dict(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
LAND = dict(viewport={"width": 844, "height": 390}, device_scale_factor=2, is_mobile=True, has_touch=True)

def act_lobby(p): p.wait_for_selector(".tile", timeout=8000); p.wait_for_timeout(600)
def tab(p, c, expect_min=1, expect_max=None):
    p.wait_for_selector(".tile"); p.click(f"#tabs button[data-c={c}]"); p.wait_for_timeout(500)
    n = int(p.inner_text("#secC").replace("款", "").strip())
    assert n >= expect_min and (expect_max is None or n <= expect_max), f"tab {c}: {n} games"
    assert p.get_attribute(f"#tabs button[data-c={c}]", "aria-selected") == "true"
def act_lobby_slots(p): tab(p, "slots", 80)
def act_lobby_fishing(p): tab(p, "fishing", 10, 10)
def act_lobby_filters(p):
    # 搜索 + 厂商过滤 + 麻将 chip；然后清空
    p.wait_for_selector(".tile"); p.click("#tabs button[data-c=slots]"); p.wait_for_timeout(300)
    p.select_option("#vendor", label=[o for o in p.eval_on_selector_all("#vendor option", "os=>os.map(o=>o.textContent)") if o.startswith("PGSoft")][0])
    p.wait_for_timeout(300); n1 = int(p.inner_text("#secC").replace("款", "")); assert 5 <= n1 <= 30, n1
    p.select_option("#vendor", value=""); p.fill("#q", "麻将"); p.wait_for_timeout(500)
    n2 = int(p.inner_text("#secC").replace("款", "")); assert n2 == 4, n2
    p.fill("#q", "zzzz-no-such"); p.wait_for_timeout(400); assert p.locator(".empty").count() == 1
    p.fill("#q", ""); p.wait_for_timeout(300)
    p.click(".chip[data-k]"); p.wait_for_timeout(400); assert int(p.inner_text("#secC").replace("款", "")) == 4
def act_lobby_scroll(p):
    # 触发全部批次渲染，度量滚动到底耗时与瓦片数
    p.wait_for_selector(".tile")
    t0 = time.time()
    for _ in range(300):
        p.evaluate("window.scrollTo(0, document.body.scrollHeight)"); p.wait_for_timeout(60)
        if p.locator(".tile").count() >= int(p.inner_text("#secC").replace("款", "")): break
    SCROLL[0] = dict(tiles=p.locator(".tile").count(), ms=int((time.time() - t0) * 1000))
    assert SCROLL[0]["tiles"] >= 180, SCROLL[0]
    p.evaluate("window.scrollTo(0, 0)"); p.wait_for_timeout(200)
SCROLL = [None]
def act_live(p):
    p.wait_for_selector(".spot", timeout=8000); p.click(".spot[data-s=banker]"); p.click(".spot[data-s=player]"); p.wait_for_timeout(400)
def act_slot(p):
    # HUIDU 精选游戏（模拟器模式）：launch → 同源 iframe → 点旋转 → 模拟器向平台发 AES 加密 settle 回调
    f = p.frame_locator("iframe"); f.locator("#spin").wait_for(timeout=10000); f.locator("#spin").click(); p.wait_for_timeout(1500)
    assert f.locator("#res").inner_text() != "", "no spin result"
def act_crash(p):
    p.wait_for_selector("#go", timeout=8000); p.click("#go"); p.wait_for_timeout(3200)
def act_plinko(p):
    p.wait_for_selector("#go", timeout=8000); p.click("#go"); p.wait_for_timeout(1200)
def act_mines(p):
    p.wait_for_selector("#go", timeout=8000); p.click("#go"); p.wait_for_timeout(300); p.click(".cell[data-i='12']"); p.wait_for_timeout(700)
def act_sports(p):
    p.wait_for_selector(".odd", timeout=8000); p.locator(".odd").nth(1).click(); p.locator(".odd").nth(4).click(); p.wait_for_timeout(400)

PAGES = [
  ("lobby", "/", act_lobby, [MOBILE, DESK]),
  ("lobby-slots", "/", act_lobby_slots, [MOBILE, DESK]),
  ("lobby-fishing", "/", act_lobby_fishing, [MOBILE, DESK]),
  ("lobby-filters", "/", act_lobby_filters, [MOBILE]),
  ("lobby-scroll", "/", act_lobby_scroll, [MOBILE, DESK]),
  ("live-baccarat", "/live.html?game=baccarat&id=live-baccarat-a", act_live, [MOBILE, DESK]),
  ("slot", "/game.html?id=pg-mahjong-ways", act_slot, [MOBILE, LAND, DESK]),
  ("fishing-game", "/game.html?id=jili-royal-fishing", act_slot, [MOBILE]),
  ("crash", "/games/crash.html", act_crash, [MOBILE, DESK]),
  ("plinko", "/games/plinko.html", act_plinko, [MOBILE, DESK]),
  ("mines", "/games/mines.html", act_mines, [MOBILE, DESK]),
  ("sports", "/sports.html", act_sports, [MOBILE, DESK]),
]
def tag(ctx):
    v = ctx["viewport"]; return "land" if v["width"] > v["height"] and v["width"] < 1000 else ("m390" if v["width"] < 600 else "d1280")

JS_CHECK = """() => {
  const vw = document.documentElement.clientWidth;
  const over = document.documentElement.scrollWidth - vw;
  const offenders = [];
  document.querySelectorAll('*').forEach(el => { const r = el.getBoundingClientRect(); if (r.width && (r.right > vw + 1 || r.left < -1)) { let p = el, clipped = false; while (p = p.parentElement) { const s = getComputedStyle(p); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) { const pr = p.getBoundingClientRect(); if (pr.right <= vw + 1) { clipped = true; break; } } } if (!clipped && getComputedStyle(el).position !== 'fixed') offenders.push((el.className && el.className.baseVal === undefined ? el.tagName + '.' + String(el.className).split(' ')[0] : el.tagName) + ' ' + Math.round(r.left) + '..' + Math.round(r.right)); } });
  const small = [];
  const vh = innerHeight;
  document.querySelectorAll('a[href],button,input,select,textarea,[role=button],[tabindex="0"]').forEach(el => {
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || el.disabled && false) return;
    if (el.closest('[hidden]')) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    if (r.bottom < 0 || r.top > vh * 3) return;
    if (el.closest('.sr') || el.className && String(el.className).indexOf('sr') === 0) return;
    if (el.tagName === 'INPUT' && el.closest('label.search')) { /* full-height input */ }
    if (r.width < 43.5 || r.height < 43.5) small.push({ el: el.tagName + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''), w: Math.round(r.width), h: Math.round(r.height), t: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 14) });
  });
  return { over, offenders: offenders.slice(0, 6), small: small.slice(0, 12), nsmall: small.length };
}"""

def main():
    engines = sys.argv[1:] or ["webkit", "chromium"]
    report = []
    with sync_playwright() as pw:
        for eng in engines:
            try:
                browser = getattr(pw, eng).launch()
            except Exception as e:
                print(f"[skip] {eng}: {str(e).splitlines()[0]}"); continue
            for name, path, act, ctxs in PAGES:
                for c in ctxs:
                    ctx = browser.new_context(locale="zh-CN", **c)
                    page = ctx.new_page(); errs = []
                    page.on("console", lambda m: errs.append(f"console.{m.type}: {m.text}") if m.type in ("error",) else None)
                    page.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
                    page.on("requestfailed", lambda r: errs.append(f"requestfailed: {r.url}"))
                    page.on("response", lambda r: errs.append(f"http{r.status}: {r.url}") if r.status >= 400 else None)
                    ext = []
                    page.on("request", lambda r: ext.append(r.url) if not r.url.startswith(BASE) and not r.url.startswith("data:") and not r.url.startswith("blob:") else None)
                    try:
                        page.goto(BASE + path, wait_until="load")
                        act(page); page.wait_for_timeout(300)
                        chk = page.evaluate(JS_CHECK)
                        fn = f"{name}-{tag(c)}-{eng}.png"
                        page.screenshot(path=os.path.join(OUT, fn), full_page=False)
                        if name == "lobby" and tag(c) == "m390":
                            page.screenshot(path=os.path.join(OUT, f"lobby-m390-full-{eng}.png"), full_page=True)
                        res = dict(engine=eng, page=name, vp=tag(c), file=fn, scroll=(SCROLL[0] if name == 'lobby-scroll' else None), overflowPx=chk["over"], offenders=chk["offenders"], smallTargets=chk["nsmall"], smallDetail=chk["small"], errors=errs, externalRequests=ext)
                    except Exception as e:
                        res = dict(engine=eng, page=name, vp=tag(c), exception=str(e).splitlines()[0], errors=errs)
                    report.append(res); ok = not res.get("exception") and res.get("overflowPx", 0) <= 0 and not res.get("errors") and res.get("smallTargets", 0) == 0
                    print(("OK  " if ok else "WARN"), eng, name, tag(c), {k: v for k, v in res.items() if k in ("overflowPx", "smallTargets", "exception") or (k == "errors" and v) or (k == "offenders" and v) or (k == "externalRequests" and v)})
                    ctx.close()
            browser.close()
    json.dump(report, open(os.path.join(OUT, "report.json"), "w"), ensure_ascii=False, indent=1)
main()
