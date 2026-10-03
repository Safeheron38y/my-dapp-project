"""兼容性/流畅度检查：多设备尺寸 × 页面 × 引擎。
 - 功能：横向溢出、控制台错误、点击目标 >= 44px（复用 shots.py 的 JS_CHECK）
 - 性能（仅 Chromium，CDP 4x CPU 降速；WebKit 无法降速，只报未降速数据）：load/FCP/首块瓦片、LCP、CLS、长任务、滚动帧间隔
用法: python scripts/compat.py [--tag before|after] [--perf-only] [--engines chromium,webkit]
输出: shots/compat-<tag>.json"""
import os, sys, json, statistics, argparse
from playwright.sync_api import sync_playwright
ap = argparse.ArgumentParser(); ap.add_argument("--tag", default="after"); ap.add_argument("--perf-only", action="store_true"); ap.add_argument("--engines", default="chromium,webkit"); ap.add_argument("--runs", type=int, default=3); ap.add_argument("--devices", default="")
A = ap.parse_args()
BASE = os.environ.get("BASE", "http://localhost:8088")
OUT = os.path.join(os.path.dirname(__file__), "..", "shots")
IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1"
AND = "Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
DEV = {
  "se375":  dict(viewport={"width": 375, "height": 667}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=IOS),
  "promax430": dict(viewport={"width": 430, "height": 932}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=IOS),
  "pixel5-393": dict(viewport={"width": 393, "height": 851}, device_scale_factor=2.75, is_mobile=True, has_touch=True, user_agent=AND),
  "s20-360": dict(viewport={"width": 360, "height": 800}, device_scale_factor=3, is_mobile=True, has_touch=True, user_agent=AND),
  "w320": dict(viewport={"width": 320, "height": 568}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=IOS),
  "ipad820": dict(viewport={"width": 820, "height": 1180}, device_scale_factor=2, is_mobile=True, has_touch=True, user_agent=IOS.replace("iPhone", "iPad")),
}
if A.devices: DEV = {k: v for k, v in DEV.items() if k in A.devices.split(",")}
src = open(os.path.join(os.path.dirname(__file__), "shots.py")).read()
JS_CHECK = src.split('JS_CHECK = """')[1].split('"""')[0]
PAGES = [("lobby", "/", ".tile"), ("slot-window", "/game.html?id=pg-mahjong-ways", "iframe")]
INIT = """(()=>{const w=window;w.__m={cls:0,lt:[],lcp:0,tile:0};
try{new PerformanceObserver(l=>{for(const e of l.getEntries()) if(!e.hadRecentInput) w.__m.cls+=e.value}).observe({type:'layout-shift',buffered:true})}catch(e){}
try{new PerformanceObserver(l=>{for(const e of l.getEntries()) w.__m.lt.push(e.duration)}).observe({type:'longtask',buffered:true})}catch(e){}
try{new PerformanceObserver(l=>{const es=l.getEntries();w.__m.lcp=es[es.length-1].startTime}).observe({type:'largest-contentful-paint',buffered:true})}catch(e){}
const mo=new MutationObserver(()=>{if(!w.__m.tile&&document.querySelector('.tile')){w.__m.tile=performance.now();mo.disconnect()}});
document.addEventListener('DOMContentLoaded',()=>mo.observe(document.documentElement,{childList:true,subtree:true}));
})()"""
SCROLL = """() => new Promise(res => { const d=[]; let last=performance.now(), n=0, y=0; const max=Math.min(document.documentElement.scrollHeight-innerHeight, 6000);
 function f(t){ d.push(t-last); last=t; y+=36; scrollTo(0,y); if(++n<120 && y<max) requestAnimationFrame(f); else res(d) } requestAnimationFrame(f) })"""
def med(a): return round(statistics.median(a), 1) if a else None
def run_perf(browser, ctxargs, url, sel, throttle):
    ctx = browser.new_context(locale="zh-CN", **ctxargs); p = ctx.new_page(); p.add_init_script(INIT)
    cdp = None
    if throttle:
        cdp = ctx.new_cdp_session(p); cdp.send("Emulation.setCPUThrottlingRate", {"rate": 4})
    p.goto(BASE + url, wait_until="load"); p.wait_for_selector(sel, timeout=20000); p.wait_for_timeout(1200)
    m = p.evaluate("""()=>{const n=performance.getEntriesByType('navigation')[0];const fcp=(performance.getEntriesByName('first-contentful-paint')[0]||{}).startTime||0;const mm=window.__m;
      return {dcl:n.domContentLoadedEventEnd,load:n.loadEventEnd,fcp:fcp,lcp:mm.lcp,tile:mm.tile,cls:mm.cls,lt:mm.lt.length,tbt:mm.lt.reduce((a,b)=>a+Math.max(0,b-50),0)}}""")
    sc = None
    if url == "/":
        d = p.evaluate(SCROLL); d = d[2:] if len(d) > 4 else d
        s = sorted(d); sc = dict(frames=len(d), avg=round(sum(d) / len(d), 1), p95=round(s[int(len(s) * .95) - 1], 1), over50=sum(1 for x in d if x > 50), max=round(max(d), 1))
    ctx.close(); return m, sc
res = dict(tag=A.tag, func=[], perf=[])
with sync_playwright() as pw:
    for eng in A.engines.split(","):
        b = getattr(pw, eng).launch()
        if not A.perf_only:
            for dn, c in DEV.items():
                for name, url, sel in PAGES:
                    ctx = b.new_context(locale="zh-CN", **c); p = ctx.new_page(); errs = []
                    p.on("console", lambda m: errs.append("console." + m.type + ": " + m.text[:120]) if m.type == "error" else None)
                    p.on("pageerror", lambda e: errs.append("pageerror: " + str(e)[:120]))
                    p.on("requestfailed", lambda r: errs.append("requestfailed: " + r.url))
                    p.on("response", lambda r: errs.append("http%d: %s" % (r.status, r.url)) if r.status >= 400 else None)
                    try:
                        p.goto(BASE + url, wait_until="load"); p.wait_for_selector(sel, timeout=15000); p.wait_for_timeout(500)
                        chk = p.evaluate(JS_CHECK)
                        r = dict(engine=eng, dev=dn, page=name, over=chk["over"], offenders=chk["offenders"], small=chk["nsmall"], smallDetail=chk["small"], errors=errs)
                    except Exception as e:
                        r = dict(engine=eng, dev=dn, page=name, exception=str(e).splitlines()[0], errors=errs)
                    res["func"].append(r)
                    bad = r.get("exception") or r.get("over", 0) > 0 or r.get("small") or r.get("errors")
                    print(("WARN" if bad else "OK  "), eng, dn, name, {k: v for k, v in r.items() if k in ("over", "small", "exception", "errors", "offenders") and v})
                    ctx.close()
        # 性能
        for dn, c in DEV.items():
            if dn not in ("se375", "pixel5-393", "ipad820", "promax430"): continue
            for name, url, sel in PAGES:
                if name in ("slot-window",) and dn not in ("pixel5-393",): continue
                ms, scs = [], []
                for i in range(A.runs):
                    m, sc = run_perf(b, c, url, sel, throttle=(eng == "chromium")); ms.append(m); scs.append(sc)
                agg = {k: med([x[k] for x in ms]) for k in ms[0]}
                sc = None
                if scs[0]: sc = {k: med([x[k] for x in scs]) for k in scs[0]}
                row = dict(engine=eng, dev=dn, page=name, throttle="4x CPU" if eng == "chromium" else "none", runs=A.runs, **agg, scroll=sc)
                res["perf"].append(row); print("PERF", json.dumps(row, ensure_ascii=False))
        b.close()
json.dump(res, open(os.path.join(OUT, "compat-%s.json" % A.tag), "w"), ensure_ascii=False, indent=1)
