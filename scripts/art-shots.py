"""艺术图层验证：大厅 390x844 / 1280x800，Chromium+WebKit；截图 art-lobby-*、横幅裁切 art-banner-*；检查溢出/控制台错误/点击目标>=44px。"""
import os, sys, json
from playwright.sync_api import sync_playwright
sys.path.insert(0, os.path.dirname(__file__))
BASE = os.environ.get("BASE", "http://localhost:8088")
OUT = os.path.join(os.path.dirname(__file__), "..", "shots")
MOBILE = dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent="Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1")
DESK = dict(viewport={"width": 1280, "height": 800}, device_scale_factor=1)
src = open(os.path.join(os.path.dirname(__file__), "shots.py")).read()
JS_CHECK = src.split('JS_CHECK = """')[1].split('"""')[0]
res = []
with sync_playwright() as pw:
    for eng in (sys.argv[1:] or ["chromium", "webkit"]):
        b = getattr(pw, eng).launch()
        for tag, c in (("m390", MOBILE), ("d1280", DESK)):
            ctx = b.new_context(locale="zh-CN", **c, reduced_motion="no-preference"); p = ctx.new_page(); errs = []
            p.on("console", lambda m: errs.append("console." + m.type + ": " + m.text) if m.type == "error" else None)
            p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            p.on("requestfailed", lambda r: errs.append("requestfailed: " + r.url))
            p.on("response", lambda r: errs.append("http%d: %s" % (r.status, r.url)) if r.status >= 400 else None)
            p.goto(BASE + "/", wait_until="load"); p.wait_for_selector(".tile"); p.wait_for_timeout(700)
            chk = p.evaluate(JS_CHECK)
            p.screenshot(path=f"{OUT}/art-lobby-{tag}-{eng}.png")
            # 轮播：逐张截取横幅
            n = p.locator(".bn-s").count()
            for i in range(n):
                p.evaluate("(i)=>{const t=document.querySelector('.bn-track');const s=t.children;t.scrollLeft=s[i].offsetLeft-s[0].offsetLeft}", i); p.wait_for_timeout(450)
                p.locator("#bn").screenshot(path=f"{OUT}/art-banner-{i+1}-{tag}-{eng}.png")
            cur = p.evaluate("[...document.querySelectorAll('.bn-dots button')].findIndex(b=>b.getAttribute('aria-current')=='true')")
            # 点击圆点 / CTA
            p.evaluate("document.querySelector('.bn-track').scrollLeft=0"); p.wait_for_timeout(300)
            p.click(".bn-dots button:nth-child(3)"); p.wait_for_timeout(900)
            dot3 = p.evaluate("[...document.querySelectorAll('.bn-dots button')].findIndex(b=>b.getAttribute('aria-current')=='true')")
            p.evaluate("window.scrollTo(0,0)")
            p.evaluate("document.querySelector('.bn-track').scrollLeft=document.querySelectorAll('.bn-s')[2].offsetLeft-document.querySelectorAll('.bn-s')[0].offsetLeft"); p.wait_for_timeout(400)
            p.click(".bn-s.b3 a[data-go]"); p.wait_for_timeout(700)
            sel = p.get_attribute("#tabs button[aria-selected=true]", "data-c"); cnt = p.inner_text("#secC")
            p.screenshot(path=f"{OUT}/art-lobby-cta-{tag}-{eng}.png")
            # 空状态 + 加载
            p.evaluate("window.scrollTo(0,0)"); p.fill("#q", "zzzz-no-such"); p.wait_for_timeout(500)
            p.locator(".empty").scroll_into_view_if_needed(); p.screenshot(path=f"{OUT}/art-empty-{tag}-{eng}.png")
            r = dict(engine=eng, vp=tag, overflowPx=chk["over"], offenders=chk["offenders"], smallTargets=chk["nsmall"], smallDetail=chk["small"], errors=errs, dotAfterDotClick=dot3, ctaTab=sel, ctaCount=cnt)
            res.append(r); print(json.dumps(r, ensure_ascii=False)); ctx.close()
        b.close()
json.dump(res, open(f"{OUT}/art-report.json", "w"), ensure_ascii=False, indent=1)
