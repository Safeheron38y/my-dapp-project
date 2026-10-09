"""玉漆月门 / Jade Lacquer 美术资源生成。
来源：/workspace/8k-design/direction-1-jade-lacquer（设计师原稿，只读）。输出：public/assets/*.svg
- banner-welcome.svg = hero-banner.svg 原样
- banner-live / banner-slots / banner-fish.svg = 同一月门构图，门内场景换成对应品类（用设计师品类图标组合）
- cat-*.svg、divider.svg(=ornament)、frame-corner.svg、pattern-seigaiha.svg 原样复制
- icons.svg 旧 sprite 重新着色为 金/玉/象牙；logo-mark / loader-ring / empty-* 由设计 token 组合的简单矢量
用法：python3 scripts/build-jade-art.py [设计目录]"""
import os, re, sys, shutil
SRC = sys.argv[1] if len(sys.argv) > 1 else "/workspace/8k-design/direction-1-jade-lacquer"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets")
rd = lambda p: open(os.path.join(SRC, p), encoding="utf-8").read()
def wr(name, s):
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(s.strip() + "\n"); print("wrote", name, len(s))

# ---- 原样复制 ----
CAT = {"slots": "slots", "live": "live", "cards": "cards", "fishing": "fishing", "mini": "mini", "sports": "sports"}
for k in CAT: shutil.copy(os.path.join(SRC, "icons", k + ".svg"), os.path.join(OUT, "cat-" + k + ".svg"))
shutil.copy(os.path.join(SRC, "ornament.svg"), os.path.join(OUT, "divider.svg"))
shutil.copy(os.path.join(SRC, "frame-corner.svg"), os.path.join(OUT, "frame-corner.svg"))
shutil.copy(os.path.join(SRC, "pattern.svg"), os.path.join(OUT, "pattern-seigaiha.svg"))
hero = rd("hero-banner.svg")
wr("banner-welcome.svg", hero)

def icon(name, pfx, x, y, size, extra=""):
    """把设计师图标内联进横幅（SVG 作为 <img> 时不能引用外部文件）；id 加前缀避免冲突"""
    s = rd("icons/" + name + ".svg")
    inner = re.search(r"<svg[^>]*>(.*)</svg>", s, re.S).group(1)
    ids = re.findall(r'id="([^"]+)"', inner)
    for i in ids:
        inner = inner.replace('id="%s"' % i, 'id="%s%s"' % (pfx, i)).replace("url(#%s)" % i, "url(#%s%s)" % (pfx, i))
    return '<svg x="%g" y="%g" width="%g" height="%g" viewBox="0 0 48 48" overflow="visible"%s>%s</svg>' % (x, y, size, size, extra, inner)

def shadow(cx, cy, rx, ry=None, op=.22):
    return '<ellipse cx="%g" cy="%g" rx="%g" ry="%g" fill="#173F35" opacity="%g" filter="url(#soft)"/>' % (cx, cy, rx, ry or rx * .2, op)

def coin(cx, cy, r, rot=0):
    return ('<g transform="translate(%g %g) rotate(%g)"><ellipse rx="%g" ry="%g" fill="url(#gold)" stroke="#8F6A2E" stroke-width="1"/>'
            '<rect x="%g" y="%g" width="%g" height="%g" fill="none" stroke="#8F6A2E" stroke-width="1.2" opacity=".8"/></g>') % (cx, cy, rot, r, r * .92, -r * .3, -r * .3, r * .6, r * .6)

DEFS_EXTRA = '''
    <linearGradient id="felt" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3E9A80"/><stop offset=".6" stop-color="#1F5E4E"/><stop offset="1" stop-color="#173F35"/></linearGradient>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#DDEBE2"/><stop offset=".45" stop-color="#A9CDBB"/><stop offset="1" stop-color="#4F977F"/></linearGradient>
    <radialGradient id="moon" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#FFFDF7"/><stop offset=".7" stop-color="#F3ECDD"/><stop offset="1" stop-color="#E8D3A0"/></radialGradient>
  </defs>'''

def variant(interior):
    s = hero.replace("</defs>", DEFS_EXTRA, 1)
    a = s.index("<!-- moon-gate interior landscape -->"); b = s.index("<!-- the gate ring")
    return s[:a] + "<!-- moon-gate interior (variant) -->\n  <g clip-path=\"url(#gate)\">\n" + interior + "\n  </g>\n\n  " + s[b:]

SKY = '''<rect x="400" y="30" width="300" height="300" fill="url(#dusk)"/>
    <circle cx="610" cy="100" r="34" fill="url(#sun)"/><circle cx="610" cy="100" r="50" fill="#F2D79A" opacity=".22"/>
    <path d="M400 214c30-30 58-48 86-40 22-34 48-52 72-30 18-16 46-24 70-4 24-10 50 4 72 30V330H400z" fill="url(#m1)"/>'''

# 真人视讯：漆面牌桌（玉色台呢 + 金边）+ 轮盘 + 牌九/纸牌
live = SKY + '''
    <path d="M400 246c40-16 80-20 120-10 40-14 90-12 140 4 14 2 28 8 40 14V330H400z" fill="url(#m2)" opacity=".85"/>
    <ellipse cx="548" cy="318" rx="190" ry="70" fill="url(#felt)"/>
    <ellipse cx="548" cy="318" rx="190" ry="70" fill="none" stroke="url(#gold)" stroke-width="4"/>
    <ellipse cx="548" cy="318" rx="160" ry="52" fill="none" stroke="#E8D3A0" stroke-width="1.2" stroke-dasharray="3 6" opacity=".7"/>
    ''' + shadow(588, 262, 72, 12, .35) + icon("live", "lv", 500, 88, 172) + shadow(486, 276, 30, 6, .3) + icon("cards", "cd", 452, 200, 66, ' transform="rotate(-10 485 233)"') + '''
    <g fill="#D9B46C"><path d="M640 170l1.6 5.4 5.4 1.6-5.4 1.6-1.6 5.4-1.6-5.4-5.4-1.6 5.4-1.6z"/></g>'''

# 老虎机 · 麻将：远山 + 玉漆老虎机 + 金币
slots = SKY + '''
    <path d="M400 238c34-22 62-28 90-12 26-30 56-36 82-12 26-14 58-14 88 6 14-4 28 0 40 8V330H400z" fill="url(#m2)"/>
    <rect x="400" y="276" width="300" height="60" fill="url(#water)"/>
    <g fill="none" stroke="#C59B4F" stroke-width="1.4" stroke-linecap="round" opacity=".7"><path d="M430 290h40M600 300h56M470 312h70"/></g>
    ''' + shadow(552, 290, 86, 14, .32) + icon("slots", "sl", 462, 104, 186) + coin(498, 300, 15, -14) + coin(522, 314, 12, 10) + coin(612, 304, 14, 18) + coin(634, 316, 10, -6)

# 深海捕鱼：门内为水下（青瓷海水 + 海浪纹 + 气泡）+ 玉鱼
fish = '''<rect x="400" y="30" width="300" height="300" fill="url(#sea)"/>
    <circle cx="610" cy="96" r="30" fill="url(#moon)" opacity=".95"/>
    <rect x="400" y="150" width="300" height="190" fill="url(#wave)" opacity=".9"/>
    <path d="M400 150c30-10 50 8 76 0s46-10 74 0 52 8 76 0 50-6 74 0" fill="none" stroke="#FBF8F1" stroke-width="3" opacity=".8"/>
    <path d="M400 290c40-26 80-30 120-14 38-20 90-24 180 0V330H400z" fill="url(#m3)" opacity=".9"/>
    <g fill="none" stroke="#E8D3A0" stroke-width="2"><circle cx="470" cy="150" r="7"/><circle cx="486" cy="128" r="4.5"/><circle cx="642" cy="196" r="6"/><circle cx="654" cy="174" r="3.5"/></g>
    <g fill="none" stroke="#2F7D68" stroke-width="5" stroke-linecap="round" opacity=".55"><path d="M430 330c0-30 10-50 4-74M446 330c4-24 14-34 10-56M664 330c-2-26-12-40-6-62"/></g>
    ''' + shadow(556, 272, 90, 12, .25) + icon("fishing", "fs", 450, 120, 206) + coin(470, 300, 12, -10) + coin(640, 296, 10, 14)

wr("banner-live.svg", variant(live))
wr("banner-slots.svg", variant(slots))
wr("banner-fish.svg", variant(fish))

# ---- 旧 sprite 改色（玫瑰金 → 拉丝金；靛紫 → 玉；珍珠白 → 象牙） ----
ic = open(os.path.join(OUT, "icons.svg"), encoding="utf-8").read()
for a, b in [("#FFF3EC", "#F5E6BE"), ("#F7D3C4", "#E8D3A0"), ("#E8B4A0", "#C59B4F"), ("#D99A8B", "#8F6A2E"), ("#4A2FA3", "#1F5E4E"), ("#2B1B5E", "#173F35"), ("#5B3CC4", "#2F7D68"), ("#C2478A", "#B3412E"), ("#F6F1FA", "#FBF8F1"), ("#FF9A76", "#D9775F"), ("#7A5BE0", "#3E9A80")]:
    ic = ic.replace(a, b).replace(a.lower(), b)
wr("icons.svg", ic)

GOLD = '<linearGradient id="au" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F5E6BE"/><stop offset=".45" stop-color="#C59B4F"/><stop offset="1" stop-color="#8F6A2E"/></linearGradient>'
JADE = '<radialGradient id="j" cx=".35" cy=".3" r=".8"><stop offset="0" stop-color="#9BD0B8"/><stop offset=".5" stop-color="#2F7D68"/><stop offset="1" stop-color="#173F35"/></radialGradient>'
# Logo：玉璧印（与预览页页眉 .seal 相同造型）
wr("logo-mark.svg", '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs>%s%s</defs>
<circle cx="32" cy="32" r="29" fill="url(#j)" stroke="url(#au)" stroke-width="3"/>
<circle cx="32" cy="32" r="22" fill="none" stroke="#E8D3A0" stroke-width="1" stroke-dasharray="2 3.5" opacity=".75"/>
<circle cx="32" cy="32" r="10" fill="#F6F0E4" stroke="url(#au)" stroke-width="2.4"/>
<circle cx="32" cy="32" r="3" fill="#B3412E"/>
<path d="M12 22a22 22 0 0 1 14-12" stroke="#fff" stroke-opacity=".55" stroke-width="3.5" stroke-linecap="round" fill="none"/></svg>''' % (GOLD, JADE))
# 加载环：象牙底上的金色弧 + 朱砂点
wr("loader-ring.svg", '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C59B4F" stop-opacity="0"/><stop offset=".6" stop-color="#C59B4F"/><stop offset="1" stop-color="#8F6A2E"/></linearGradient></defs>
<circle cx="32" cy="32" r="28" fill="none" stroke="#C59B4F" stroke-opacity=".22" stroke-width="2.5"/>
<circle cx="32" cy="32" r="28" fill="none" stroke="#C59B4F" stroke-opacity=".35" stroke-width="1" stroke-dasharray="1.5 5" transform="scale(.86) translate(5.2 5.2)"/>
<path d="M32 4A28 28 0 0 1 60 32" fill="none" stroke="url(#g)" stroke-width="3.2" stroke-linecap="round"/>
<circle cx="60" cy="32" r="3.4" fill="#B3412E" stroke="#F5E6BE" stroke-width="1"/></svg>''')

# 空状态：小月门 + 云纹 + 主题物件（细金线），简单组合
def empty(name, inner):
    wr(name, '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 120" width="160" height="120"><defs>%s%s
<linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FBF8F1"/><stop offset="1" stop-color="#DDEBE2"/></linearGradient>
<symbol id="cl" viewBox="0 0 120 44"><path d="M8 38h96c8 0 12-6 10-12-2-7-10-9-15-6 1-9-7-16-16-14-3-7-13-10-20-5-6-6-18-4-21 5-8-2-16 4-15 12-8 0-13 5-13 10 0 6 4 10 12 10z" fill="#FBF8F1" stroke="#C59B4F" stroke-width="2.4"/></symbol></defs>
<ellipse cx="80" cy="108" rx="54" ry="6" fill="#A9CDBB" opacity=".45"/>
<circle cx="80" cy="58" r="44" fill="url(#d)"/>
<circle cx="80" cy="58" r="44" fill="none" stroke="url(#j)" stroke-width="7"/>
<circle cx="80" cy="58" r="49" fill="none" stroke="url(#au)" stroke-width="1.2"/>
<path d="M48 30a44 44 0 0 1 30-15" stroke="#fff" stroke-opacity=".55" stroke-width="2.5" stroke-linecap="round" fill="none"/>
%s
<use href="#cl" x="112" y="84" width="40" height="15"/><use href="#cl" x="10" y="20" width="30" height="11" opacity=".9"/>
<path d="M140 30l1.3 4.2 4.2 1.3-4.2 1.3-1.3 4.2-1.3-4.2-4.2-1.3 4.2-1.3z" fill="#D9B46C"/></svg>''' % (GOLD, JADE, inner))
empty("empty-search.svg", '<g fill="none" stroke-linecap="round"><circle cx="76" cy="54" r="15" stroke="#1F5E4E" stroke-width="4.5"/><circle cx="76" cy="54" r="15" stroke="url(#au)" stroke-width="1.2" transform="scale(1.18) translate(-11.6 -8.2)"/><path d="M87 66l13 13" stroke="#1F5E4E" stroke-width="6"/></g><circle cx="76" cy="54" r="3" fill="#B3412E"/>')
empty("empty-error.svg", '<path d="M50 88q12-16 24-18M86 70q12 2 24 18" fill="none" stroke="#B3412E" stroke-width="4.5" stroke-linecap="round"/><g fill="#1F5E4E"><rect x="75.5" y="28" width="9" height="26" rx="4.5"/><circle cx="80" cy="64" r="5"/></g><g stroke="#C59B4F" stroke-width="1.4" stroke-linecap="round"><path d="M58 92h44"/></g>')
empty("empty-fav.svg", '<g transform="translate(80 58)"><g fill="#B3412E"><circle cx="0" cy="-10" r="8"/><circle cx="9.5" cy="-3" r="8"/><circle cx="6" cy="8" r="8"/><circle cx="-6" cy="8" r="8"/><circle cx="-9.5" cy="-3" r="8"/></g><circle r="4.5" fill="#F5E6BE"/></g><path d="M100 30c-8 6-12 12-14 18" stroke="#5B3A22" stroke-width="3" stroke-linecap="round" fill="none"/>')
# 旧的玫瑰金图案已不再使用
for old in ("pattern-cloud.svg", "pattern-sparkle.svg", "pattern-wave.svg"):
    p = os.path.join(OUT, old)
    if os.path.exists(p): os.remove(p); print("removed", old)

# ---- 设计师终稿（2026-10 交付）：存在则原样覆盖上面的临时组合稿 ----
# 横幅只用无字插画版（标题保留为 HTML 文本）；*-titled.svg 不用于卡片。
# loader.svg 自带动画，不使用：应用沿用静态 loader-ring.svg + CSS 旋转。
FINAL = ["banner-slots.svg", "banner-live.svg", "banner-fish.svg", "empty-search.svg", "empty-error.svg", "empty-fav.svg",
         "logo-mark.svg", "logo-mark-mono.svg", "loader-ring.svg", "pattern-paper.svg"]
for f in FINAL:
    p = os.path.join(SRC, f)
    if os.path.exists(p): shutil.copy(p, os.path.join(OUT, f)); print("designer", f)
