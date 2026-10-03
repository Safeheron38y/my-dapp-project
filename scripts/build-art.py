"""生成 public/assets/*.svg（原创矢量图，无位图）。运行：python3 scripts/build-art.py
所有插画均为手工设计的几何+渐变，输出已压缩（数值取 1 位小数、无多余空白）。"""
import math, os, re
OUT = os.path.join(os.path.dirname(__file__), "..", "public", "assets")
os.makedirs(OUT, exist_ok=True)

def n(x):
    s = ("%.1f" % x).rstrip("0").rstrip(".")
    return "0" if s in ("-0", "") else s
def mini(s):
    s = re.sub(r">\s+<", "><", s.strip()); s = re.sub(r"\s{2,}", " ", s); return s
def save(name, s):
    s = mini(s)
    open(os.path.join(OUT, name), "w", encoding="utf-8").write(s)
    print("%-22s %5d B" % (name, len(s.encode())))
def svg(vb, body, extra=""):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="%s"%s>%s</svg>' % (vb, extra, body)
def lg(i, stops, x1=0, y1=0, x2=0, y2=1, units=""):
    return '<linearGradient id="%s" x1="%s" y1="%s" x2="%s" y2="%s"%s>%s</linearGradient>' % (i, x1, y1, x2, y2, units, "".join('<stop offset="%s" stop-color="%s"%s/>' % (o, c, (' stop-opacity="%s"' % a) if a is not None else "") for o, c, a in [(s + (None,))[:3] if len(s) == 2 else s for s in stops]))
def rg(i, stops, cx=.5, cy=.5, r=.5):
    return '<radialGradient id="%s" cx="%s" cy="%s" r="%s">%s</radialGradient>' % (i, cx, cy, r, "".join('<stop offset="%s" stop-color="%s"%s/>' % (s[0], s[1], (' stop-opacity="%s"' % s[2]) if len(s) > 2 else "") for s in stops))

SPARK = '<path id="sp" d="M0-1Q.12-.12 1 0Q.12 .12 0 1Q-.12 .12-1 0Q-.12-.12 0-1Z"/>'
def sp(x, y, s, fill="#fff", op=1, rot=0):
    return '<use href="#sp" transform="translate(%s %s)%s scale(%s)" fill="%s"%s/>' % (n(x), n(y), (" rotate(%s)" % rot) if rot else "", n(s), fill, (' opacity="%s"' % op) if op != 1 else "")

# ---- 通用元件 ----
# 8K 字标（来自平台 logo 的几何：两环 8 + K），坐标系 380x210
EMB = '<circle cx="100" cy="62" r="36"/><circle cx="100" cy="142" r="46"/><path d="M232 24V186M338 26L236 108M266 92L342 184"/>'

def coin_side_stack(cx, cy, cnt, rx, th=8, tilt=0):
    ry = rx * .36; out = ""
    for i in range(cnt):
        y = cy - i * (th + 1)
        jit = ((i * 37) % 5 - 2) * 1.2
        out += '<g transform="translate(%s 0)"><path d="M%s %sv%sa%s %s 0 0 0 %s 0v-%s" fill="url(#cs)"/><ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#cf)"/><ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="none" stroke="#C57A45" stroke-opacity=".55" stroke-width="1"/></g>' % (n(jit), n(cx - rx), n(y), th, n(rx), n(ry), n(2 * rx), th, n(cx), n(y), n(rx), n(ry), n(cx), n(y), n(rx * .72), n(ry * .72))
    return out

def chip_flat(cx, cy, rx, th, c1, c2, rim="#fff"):
    ry = rx * .38; k = rx
    side = '<path d="M%s %sv%sa%s %s 0 0 0 %s 0v-%s" fill="url(#%s)"/>' % (n(cx - rx), n(cy), th, n(rx), n(ry), n(2 * rx), th, c2)
    stripes = '<path d="M%s %sv%sa%s %s 0 0 0 %s 0v-%s" fill="none" stroke="%s" stroke-opacity=".7" stroke-width="%s" stroke-dasharray="7 9" transform="translate(0 -%s)"/>' % (n(cx - rx), n(cy + th * .5), 0.01, n(rx), n(ry), n(2 * rx), 0.01, rim, th - 3, 0) if False else ""
    top = '<g transform="translate(%s %s) scale(1 .38)"><circle r="%s" fill="url(#%s)"/><circle r="%s" fill="none" stroke="%s" stroke-width="%s" stroke-dasharray="%s %s"/><circle r="%s" fill="none" stroke="%s" stroke-opacity=".8" stroke-width="2"/><circle r="%s" fill="%s" fill-opacity=".35"/></g>' % (n(cx), n(cy), n(k), c1, n(k * .86), rim, n(k * .22), n(k * .3), n(k * .26), n(k * .62), rim, n(k * .5), c2 and "#fff")
    return side + top

# ===================== 横幅插画 =====================
def banner_welcome():
    rays = "".join('<path d="M250 150L%s %sL%s %sZ"/>' % (n(250 + 330 * math.cos(math.radians(a - 4))), n(150 + 330 * math.sin(math.radians(a - 4))), n(250 + 330 * math.cos(math.radians(a + 4))), n(150 + 330 * math.sin(math.radians(a + 4)))) for a in range(0, 360, 30))
    defs = (lg("cf", [(0, "#FFF0C9"), (.5, "#F7C46F"), (1, "#E39A55")], 0, 0, 1, 1) + lg("cs", [(0, "#B8683A"), (.3, "#F2B56A"), (.55, "#FFE2A6"), (.8, "#E39A55"), (1, "#A8573C")], 0, 0, 1, 0) +
            lg("rim", [(0, "#FFF3D2"), (.45, "#EFA85D"), (1, "#B8683A")], 0, 0, 1, 1) + rg("gl", [(0, "#FFC9A8", .75), (.55, "#E8709F", .28), (1, "#7A5BE0", 0)]) +
            lg("cv", [(0, "#8F6BFF"), (1, "#4A2FA3")]) + lg("cv2", [(0, "#4A2FA3"), (1, "#2B1B5E")]) + lg("cr", [(0, "#F2699F"), (1, "#B53A7C")]) + lg("cr2", [(0, "#B53A7C"), (1, "#6A2158")]) +
            lg("ci", [(0, "#4D3A9A"), (1, "#241556")]) + lg("ci2", [(0, "#241556"), (1, "#150C38")]) + lg("sh", [(0, "#FFF"), (1, "#FFD6C0")]) + SPARK +
            '<g id="mc"><circle r="14" fill="url(#rim)"/><circle r="10.5" fill="url(#cf)"/><circle r="7.5" fill="none" stroke="#C57A45" stroke-opacity=".6" stroke-width="1.6"/></g>')
    coin = ('<g transform="translate(250 150) rotate(-14)"><circle cx="8" cy="10" r="88" fill="#A8573C"/><circle cx="4" cy="5" r="88" fill="#D78A4A"/><circle r="88" fill="url(#rim)"/><circle r="79" fill="url(#cf)"/>'
            '<circle r="73" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3" stroke-dasharray="2 5.4" stroke-linecap="round"/><circle r="62" fill="none" stroke="#C57A45" stroke-opacity=".55" stroke-width="1.6"/>'
            '<g transform="translate(-60 -33) scale(.315)" fill="none" stroke-width="26" stroke-linejoin="round" stroke-linecap="round"><g stroke="#fff" stroke-opacity=".75" transform="translate(-4 -4)">' + EMB + '</g><g stroke="#A8573C">' + EMB + '</g></g>'
            '<path d="M-66 -34A74 74 0 0 1 -10 -72" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="3" stroke-linecap="round"/></g>')
    chips = (chip_flat(318, 276, 50, 10, "cv", "cv2") + chip_flat(318, 266, 50, 10, "cr", "cr2") + chip_flat(318, 256, 50, 10, "ci", "ci2", "#F7D3C4"))
    back_chip = '<g transform="translate(350 205) rotate(14)"><circle r="40" fill="url(#cr2)" transform="translate(4 5)"/><circle r="40" fill="url(#cr)"/><circle r="34" fill="none" stroke="#fff" stroke-width="9" stroke-dasharray="11 14"/><circle r="22" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="2"/><circle r="17" fill="#FFD6C0"/><path d="M-9-2h18M-9 3h12" stroke="#B53A7C" stroke-width="2.6" stroke-linecap="round"/></g>'
    flying = "".join('<use href="#mc" transform="translate(%s %s) rotate(%s) scale(%s %s)"/>' % (n(x), n(y), r, n(s), n(s2)) for x, y, r, s, s2 in [(112, 62, -20, 1.1, .5), (372, 70, 25, 1, .8), (66, 175, 10, 1.3, .35), (156, 128, -40, .8, .9), (392, 150, 0, .8, .5), (205, 30, 18, .9, .45)])
    sparks = sp(150, 40, 9, "#FFE9C7") + sp(345, 24, 6, "#fff") + sp(80, 112, 7, "#F7D3C4") + sp(372, 112, 8, "#FFE9C7") + sp(188, 236, 6, "#fff") + sp(248, 28, 5, "#FFE9C7", .8) + sp(30, 60, 5, "#fff", .8)
    body = '<defs>%s</defs><circle cx="250" cy="150" r="190" fill="url(#gl)"/><g fill="#fff" opacity=".09">%s</g>%s%s%s<g transform="translate(78 292)">%s</g><g transform="translate(6 0)">%s</g>%s%s' % (defs, rays, back_chip, chips, coin, coin_side_stack(0, 0, 6, 40), "", flying, sparks)
    body = body.replace('<g transform="translate(6 0)"></g>', "")
    # 左下第二叠
    body += '<g transform="translate(32 300)">%s</g>' % coin_side_stack(0, 0, 3, 30)
    return svg("0 0 400 320", body)

def card(a, rank, suit, color, back=False):
    s = '<g transform="translate(225 312) rotate(%s)"><g transform="translate(-48 -196)"><rect width="96" height="140" rx="11" fill="#2B1B5E" opacity=".28" transform="translate(5 6)"/>' % a
    if back:
        s += '<rect width="96" height="140" rx="11" fill="url(#bk)"/><rect x="6" y="6" width="84" height="128" rx="7" fill="none" stroke="url(#gd)" stroke-width="1.6"/><rect x="12" y="12" width="72" height="116" rx="4" fill="url(#lat)" opacity=".9"/><g transform="translate(48 70)"><circle r="19" fill="#2B1B5E" stroke="url(#gd)" stroke-width="2"/><g transform="translate(-12 -6.6) scale(.105)" fill="none" stroke="url(#gd)" stroke-width="26" stroke-linecap="round" stroke-linejoin="round">' + EMB + '</g></g></g></g>'
        return s
    s += '<rect width="96" height="140" rx="11" fill="url(#pf)"/><rect x=".5" y=".5" width="95" height="139" rx="10.5" fill="none" stroke="#D9C9E8" stroke-opacity=".9"/>'
    s += '<text x="9" y="26" font-family="Georgia,\'Times New Roman\',serif" font-size="25" font-weight="700" fill="%s">%s</text><use href="#%s" transform="translate(17 40) scale(.62)" fill="%s"/>' % (color, rank, suit, color)
    s += '<use href="#%s" transform="translate(48 82) scale(2.3)" fill="%s"/>' % (suit, color)
    s += '<g transform="rotate(180 48 70)"><text x="9" y="26" font-family="Georgia,serif" font-size="25" font-weight="700" fill="%s">%s</text><use href="#%s" transform="translate(17 40) scale(.62)" fill="%s"/></g>' % (color, rank, suit, color)
    return s + '</g></g>'

def banner_live():
    defs = (lg("pf", [(0, "#FFFFFF"), (1, "#EADFF5")], 0, 0, 1, 1) + lg("bk", [(0, "#7A5BE0"), (1, "#C2478A")], 0, 0, 1, 1) + lg("gd", [(0, "#FFF3EC"), (.5, "#E8B4A0"), (1, "#D99A8B")], 0, 0, 1, 1) +
            '<pattern id="lat" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0H12M0 0V12" stroke="#F7D3C4" stroke-opacity=".35" stroke-width=".9" fill="none"/></pattern>' +
            lg("cone", [(0, "#FFF", .42), (1, "#FFF", 0)]) + lg("felt", [(0, "#6A3BB8"), (1, "#2B1B5E")]) + rg("gl", [(0, "#FFC9A8", .55), (.6, "#C2478A", .18), (1, "#7A5BE0", 0)]) +
            lg("cv", [(0, "#8F6BFF"), (1, "#4A2FA3")]) + lg("cv2", [(0, "#4A2FA3"), (1, "#2B1B5E")]) + lg("cr", [(0, "#F2699F"), (1, "#B53A7C")]) + lg("cr2", [(0, "#B53A7C"), (1, "#6A2158")]) + lg("cp", [(0, "#FFE0C9"), (1, "#E8A98F")]) + lg("cp2", [(0, "#E8A98F"), (1, "#A8625A")]) +
            '<path id="ht" d="M0 9C-15-2-11-13-4.500-12C-2-11.500 0-9 0-7C0-9 2-11.500 4.500-12C11-13 15-2 0 9Z"/><path id="dm" d="M0-11L8 0L0 11L-8 0Z"/><g id="sd"><use href="#ht" transform="scale(1 -1)"/><path d="M0 4L-5 12H5Z"/></g>' + SPARK)
    stack = lambda x, y, c1, c2, cnt: "".join(chip_flat(x, y - i * 11, 36, 8, c1, c2) for i in range(cnt))
    body = ('<defs>%s</defs><ellipse cx="225" cy="190" rx="200" ry="150" fill="url(#gl)"/><path d="M225-10L40 330H410Z" fill="url(#cone)" opacity=".55"/>'
            '<path d="M-10 300Q215 236 410 300V330H-10Z" fill="url(#felt)"/><path d="M-10 300Q215 236 410 300" fill="none" stroke="url(#gd)" stroke-width="3"/><path d="M-10 308Q215 244 410 308" fill="none" stroke="#F7D3C4" stroke-opacity=".3" stroke-width="1"/>' % defs)
    body += card(-36, "", "", "", True) + card(-12, "A", "sd", "#2B1B5E") + card(12, "K", "ht", "#C2478A") + card(36, "Q", "dm", "#C2478A")
    body += stack(66, 306, "cr", "cr2", 4) + stack(348, 312, "cv", "cv2", 3) + chip_flat(380, 298, 30, 7, "cp", "cp2") + chip_flat(36, 316, 30, 7, "cv", "cv2")
    body += sp(70, 80, 10, "#FFE9C7") + sp(372, 62, 8, "#fff") + sp(120, 150, 6, "#F7D3C4") + sp(330, 150, 6, "#FFE9C7") + sp(200, 30, 6, "#fff", .8) + sp(30, 150, 5, "#fff", .8)
    return svg("0 0 400 320", body)

def lantern(cx, top, w, h, sid):
    ry = h / 2; cy = top + 14 + ry
    return ('<g><path d="M%s -10V%s" stroke="#E8B4A0" stroke-width="2"/><rect x="%s" y="%s" width="%s" height="9" rx="3" fill="url(#gd)"/>'
            '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="url(#lan)"/><ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="none" stroke="#7A1E5E" stroke-opacity=".45" stroke-width="1.4"/><ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="none" stroke="#7A1E5E" stroke-opacity=".35" stroke-width="1.2"/>'
            '<path d="M%s %sH%s" stroke="url(#gd)" stroke-width="1.4"/><path d="M%s %sH%s" stroke="url(#gd)" stroke-width="1.4"/>'
            '<ellipse cx="%s" cy="%s" rx="%s" ry="%s" fill="#fff" opacity=".22"/><rect x="%s" y="%s" width="%s" height="9" rx="3" fill="url(#gd)"/>'
            '<path d="M%s %sV%s" stroke="#F2699F" stroke-width="2.2"/><path d="M%s %sV%s M%s %sV%s" stroke="#F2699F" stroke-width="1.4"/><circle cx="%s" cy="%s" r="4.500" fill="url(#gd)"/></g>') % (
        n(cx), n(top + 4), n(cx - w * .2), n(top + 5), n(w * .4), n(cx), n(cy), n(w / 2), n(ry), n(cx), n(cy), n(w * .27), n(ry), n(cx), n(cy), n(w * .1), n(ry),
        n(cx - w * .46), n(cy - ry * .45), n(cx + w * .46), n(cx - w * .46), n(cy + ry * .45), n(cx + w * .46),
        n(cx - w * .16), n(cy - ry * .35), n(w * .1), n(ry * .45), n(cx - w * .2), n(cy + ry - 2), n(w * .4),
        n(cx), n(cy + ry + 7), n(cy + ry + 30), n(cx - 5), n(cy + ry + 7), n(cy + ry + 26), n(cx + 5), n(cy + ry + 7), n(cy + ry + 26), n(cx), n(cy + ry + 32))

def tile(x, y, rot, face):
    return ('<g transform="translate(%s %s) rotate(%s)"><rect x="-38" y="-48" width="84" height="108" rx="12" fill="#14584F" opacity=".35" transform="translate(5 8)"/><rect x="-38" y="-48" width="84" height="108" rx="12" fill="url(#jd)" transform="translate(6 8)"/>'
            '<rect x="-44" y="-56" width="84" height="108" rx="12" fill="url(#iv)"/><rect x="-42.500" y="-54.500" width="81" height="105" rx="10.500" fill="none" stroke="#E5D6C8" stroke-width="1.2"/>%s</g>') % (n(x), n(y), rot, face)

def banner_slots():
    defs = (lg("gd", [(0, "#FFF3EC"), (.5, "#E8B4A0"), (1, "#D99A8B")], 0, 0, 1, 1) + '<radialGradient id="lan" cx=".38" cy=".32" r=".8"><stop offset="0" stop-color="#FF9AA8"/><stop offset=".45" stop-color="#E5456F"/><stop offset="1" stop-color="#8A2063"/></radialGradient>' +
            lg("jd", [(0, "#35C2A8"), (1, "#127068")], 0, 0, 1, 1) + lg("iv", [(0, "#FFFDF8"), (1, "#F0E3D6")], 0, 0, 1, 1) + rg("gl", [(0, "#FFC9A8", .6), (.6, "#C2478A", .2), (1, "#7A5BE0", 0)]) +
            lg("bam", [(0, "#4FD1A3"), (1, "#1A8F6E")], 0, 0, 1, 0) + SPARK +
            '<path id="cl" d="M0 20c-12 0-14-14-4-17 2-10 16-12 21-4 6-8 20-4 19 7 9 0 10 14 0 14z" /><g id="dot"><circle r="10" fill="#4A2FA3"/><circle r="7.500" fill="#fff"/><circle r="5.500" fill="#7A5BE0"/><circle r="2.400" fill="#C2478A"/></g>')
    zhong = '<g fill="none" stroke="#D6245E" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"><rect x="-22" y="-26" width="44" height="34" rx="3" transform="translate(-2 0)"/><path d="M-2 -42V42"/></g>'
    dots = "".join('<use href="#dot" transform="translate(%s %s)"/>' % (a, b) for a, b in [(-24, -30), (20, -30), (-2, 0), (-24, 30), (20, 30)])
    bam = "".join('<g transform="translate(%s %s)"><rect x="-5" y="-18" width="10" height="36" rx="5" fill="url(#bam)"/><path d="M-5 -2H5" stroke="#0E5A44" stroke-width="1.6"/><path d="M-2 -14v5M-2 8v5" stroke="#fff" stroke-opacity=".5" stroke-width="1.8" stroke-linecap="round"/></g>' % (a, b) for a, b in [(-20, -30), (-2, -30), (16, -30), (-11, 14), (9, 14)])
    body = ('<defs>%s</defs><circle cx="230" cy="170" r="190" fill="url(#gl)"/>' % defs)
    body += '<g fill="#F7D3C4" opacity=".16"><use href="#cl" transform="translate(20 230) scale(1.6)"/><use href="#cl" transform="translate(300 250) scale(1.3)"/><use href="#cl" transform="translate(330 110) scale(.8)"/></g>'
    body += tile(150, 184, -14, '<g transform="translate(-2 -2)">%s</g>' % zhong) + tile(262, 196, 9, '<g transform="translate(-2 -2)">%s</g>' % dots) + tile(206, 150, -2, '<g transform="translate(-2 -2)">%s</g>' % bam)
    body += lantern(318, 0, 66, 78, 1) + lantern(380, 0, 40, 48, 2) + lantern(58, 0, 44, 52, 3)
    body += ('<g transform="translate(70 300)"><ellipse cx="0" cy="0" rx="46" ry="11" fill="#2B1B5E" opacity=".35"/></g>')
    body += sp(110, 70, 9, "#FFE9C7") + sp(250, 40, 6, "#fff") + sp(370, 190, 8, "#FFE9C7") + sp(40, 160, 6, "#F7D3C4") + sp(330, 285, 6, "#fff") + sp(180, 290, 7, "#FFE9C7") + sp(396, 120, 5, "#fff", .8)
    return svg("0 0 400 320", body)

def fish(i, c1, c2, c3):
    return ('<g id="%s"><path d="M-38 0C-58-10-72-28-90-32C-83-14-83 14-90 32C-72 28-58 10-38 0Z" fill="url(#%st)" opacity=".92"/><path d="M-50 0C-64-4-74-12-82-20M-50 0C-64 4-74 12-82 20" stroke="#fff" stroke-opacity=".4" fill="none" stroke-width="1.2"/>'
            '<path d="M26-26C14-46-10-48-22-40C-14-34-6-30-4-26Z" fill="url(#%st)"/><path d="M12 24C8 38-6 44-18 44C-15 34-11 28-8 25Z" fill="url(#%st)"/>'
            '<path d="M56 0C48-22 18-32-8-26C-26-22-36-10-42-3L-42 3C-36 10-26 22-8 26C18 32 48 22 56 0Z" fill="url(#%sb)"/>'
            '<path d="M34-14C14-22-8-18-22-8C-6-10 14-8 34-14Z" fill="#fff" opacity=".28"/><ellipse cx="2" cy="-2" rx="20" ry="9" fill="#fff" opacity=".14"/>'
            '<g fill="none" stroke="#fff" stroke-opacity=".32" stroke-width="1.1"><path d="M-14-10q6 6 0 12M-4-12q6 8 0 16M6-12q6 8 0 16"/><path d="M-24 4q6 5 12 0M-12 10q6 5 12 0"/></g>'
            '<path d="M24-18Q17 0 24 18" fill="none" stroke="#fff" stroke-opacity=".45" stroke-width="1.6" stroke-linecap="round"/><circle cx="38" cy="-6" r="5.500" fill="#fff"/><circle cx="39.500" cy="-6" r="3.300" fill="#2B1B5E"/><circle cx="40.500" cy="-7.300" r="1.100" fill="#fff"/></g>') % (i, i, i, i, i)

def banner_fish():
    def fg(i, a, b, c):
        return lg(i + "b", [(0, a), (.55, b), (1, c)], 0, 0, 0, 1) + lg(i + "t", [(0, b), (1, c)], 0, 0, 1, 0)
    defs = (fg("f1", "#FFD0A8", "#FF8FA3", "#C2478A") + fg("f2", "#C9B6FF", "#8F6BFF", "#4A2FA3") + fg("f3", "#FFF0DC", "#F0B49A", "#D99A8B") + lg("sea", [(0, "#7A5BE0", 0), (1, "#2B1B5E", .55)]) + rg("gl", [(0, "#FFC9A8", .5), (.6, "#C2478A", .18), (1, "#7A5BE0", 0)]) +
            lg("shaft", [(0, "#fff", .3), (1, "#fff", 0)]) + rg("bub", [(0, "#fff", .05), (.7, "#fff", .1), (1, "#fff", .5)]) + lg("wv1", [(0, "#8F6BFF", .55), (1, "#4A2FA3", .85)]) + lg("wv2", [(0, "#C2478A", .5), (1, "#6A2158", .85)]) + lg("cor", [(0, "#FFB08A"), (1, "#C2478A")]) + lg("gd", [(0, "#FFF3EC"), (.5, "#E8B4A0"), (1, "#D99A8B")], 0, 0, 1, 1) + lg("cf", [(0, "#FFF0C9"), (.5, "#F7C46F"), (1, "#E39A55")], 0, 0, 1, 1) + SPARK +
            fish("f1", 0, 0, 0) + fish("f2", 0, 0, 0) + fish("f3", 0, 0, 0) +
            '<g id="bb"><circle r="10" fill="url(#bub)" stroke="#fff" stroke-opacity=".75" stroke-width="1.2"/><path d="M-5.500-3A6.500 6.500 0 0 1 -1-7" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></g>')
    bubs = "".join('<use href="#bb" transform="translate(%s %s) scale(%s)"/>' % (n(x), n(y), n(s)) for x, y, s in [(70, 250, 1.1), (92, 214, .7), (60, 170, .5), (330, 88, 1), (352, 54, .6), (314, 40, .45), (140, 90, .8), (250, 262, .6), (386, 190, .7), (200, 40, .5), (118, 280, .5)])
    body = ('<defs>%s</defs><circle cx="230" cy="150" r="190" fill="url(#gl)"/><g fill="url(#shaft)"><path d="M120-10L170-10L250 330H150Z"/><path d="M230-10L262-10L340 330H280Z" opacity=".7"/></g>' % defs)
    body += '<use href="#f2" transform="translate(110 108) rotate(8) scale(.62)"/><use href="#f3" transform="translate(330 232) rotate(-12) scale(.55) scale(-1 1)"/><use href="#f1" transform="translate(236 154) rotate(-10) scale(1.28)"/>'
    body += '<g transform="translate(338 120)"><circle r="18" fill="url(#bub)" stroke="#fff" stroke-opacity=".8" stroke-width="1.4"/><circle r="11" fill="url(#cf)"/><circle r="8" fill="none" stroke="#C57A45" stroke-opacity=".6" stroke-width="1.4"/></g>'
    body += bubs
    body += '<path d="M0 270Q60 246 120 266T250 262T400 258V330H0Z" fill="url(#wv1)"/><path d="M0 292Q70 274 140 290T280 284T400 286V330H0Z" fill="url(#wv2)"/><path d="M0 270Q60 246 120 266T250 262T400 258" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.4"/>'
    body += '<g fill="url(#cor)"><path d="M28 310C24 286 14 276 20 262C26 274 34 280 36 296C40 280 52 272 54 258C58 276 48 290 44 310Z"/><path d="M360 312C358 292 372 280 368 262C376 276 382 290 378 312Z" opacity=".9"/></g>'
    body += sp(60, 60, 8, "#FFE9C7") + sp(370, 150, 7, "#fff") + sp(180, 70, 5, "#fff", .8) + sp(300, 20, 6, "#FFE9C7") + sp(14, 140, 5, "#fff", .8)
    return svg("0 0 400 320", body)

save("banner-welcome.svg", banner_welcome())
save("banner-live.svg", banner_live())
save("banner-slots.svg", banner_slots())
save("banner-fish.svg", banner_fish())

# ===================== 分类图标（双色玫瑰金，sprite） =====================
def A(d, extra=""): return '<path d="%s" style="fill:var(--i1,url(#rg))"%s/>' % (d, extra)
def B(d, extra=""): return '<path d="%s" style="fill:var(--i2,#4A2FA3)"%s/>' % (d, extra)
def Cf(d, extra=""): return '<path d="%s" style="fill:var(--i3,#F6F1FA)"%s/>' % (d, extra)
def Cs(d, w=1.8): return '<path d="%s" fill="none" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--i3,#F6F1FA)" stroke-width="%s"/>' % (d, w)
def Bs(d, w=1.8): return '<path d="%s" fill="none" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--i2,#4A2FA3)" stroke-width="%s"/>' % (d, w)
def rect(x, y, w, h, r, kind="A"): return '<rect x="%s" y="%s" width="%s" height="%s" rx="%s" style="fill:var(%s)"/>' % (x, y, w, h, r, {"A": "--i1,url(#rg)", "B": "--i2,#4A2FA3", "C": "--i3,#F6F1FA"}[kind])
def circ(x, y, r, kind="A"): return '<circle cx="%s" cy="%s" r="%s" style="fill:var(%s)"/>' % (x, y, r, {"A": "--i1,url(#rg)", "B": "--i2,#4A2FA3", "C": "--i3,#F6F1FA"}[kind])
STAR = lambda x, y, s, kind="C": '<path d="M%s %sq%s %s %s %s q%s %s %s %s q%s %s %s %s q%s %s %s %sz" style="fill:var(%s)"/>' % (x, y - s, 0, s * .8, s * .9, s, -s * .9, s * .2, -s * .9, s * .8, 0, 0, 0, 0, 0, 0, 0, 0, "--i3,#F6F1FA")
def star(x, y, s, kind="C"):
    v = {"A": "--i1,url(#rg)", "B": "--i2,#4A2FA3", "C": "--i3,#F6F1FA"}[kind]
    return '<path d="M%s %sQ%s %s %s %sQ%s %s %s %sQ%s %s %s %sQ%s %s %s %sZ" style="fill:var(%s)"/>' % (n(x), n(y - s), n(x + s * .12), n(y - s * .12), n(x + s), n(y), n(x + s * .12), n(y + s * .12), n(x), n(y + s), n(x - s * .12), n(y + s * .12), n(x - s), n(y), n(x - s * .12), n(y - s * .12), n(x), n(y - s), v)

ICONS = {
 "i-live": Cs("M4 8a8.500 8.500 0 0 0 0 7.500M28 8a8.500 8.500 0 0 1 0 7.500", 1.8) + A("M5 28.500c0-6.200 4.800-10.500 11-10.500s11 4.300 11 10.500z") + circ(16, 10.500, 5.800) + B("M16 20.500l-3.800-2.400v4.800zM16 20.500l3.800-2.400v4.800z") + Cf("M16 18.200l-2.200 3.600h4.400z", ' opacity=".9"') if False else
        Cs("M4 8a8.500 8.500 0 0 0 0 7.500M28 8a8.500 8.500 0 0 1 0 7.500", 1.8) + A("M5 28.500c0-6.200 4.800-10.500 11-10.500s11 4.300 11 10.500z") + circ(16, 10.500, 5.800) + B("M16 22.500l-3.800-2.400v4.800zM16 22.500l3.800-2.400v4.800z") + circ(16, 22.500, 1.200, "C"),
 "i-slots": rect(3.500, 5.500, 22, 21, 4.500) + rect(7, 10, 15, 9, 2.500, "B") + circ(11, 14.500, 1.700, "C") + circ(14.500, 14.500, 1.700, "C") + circ(18, 14.500, 1.700, "C") + rect(8.500, 21.500, 12, 2.200, 1.100, "B") + rect(27, 11, 2.600, 10, 1.300, "A") + circ(28.300, 9, 2.700, "C"),
 "i-table": Cs("M4.500 9.500l9-3.300 4.500 12.500-9 3.300z", 1.8) + '<g transform="rotate(10 20 17)">' + rect(12.500, 6, 15, 21, 3) + '</g>' + '<g transform="translate(20 17.500) rotate(10)">' + B("M0 -5.500c-5 3.800-4.500 7-1.700 7 .8 0 1.400-.4 1.700-1-.1 1.200-.5 2-1.400 2.800h2.800c-.9-.8-1.300-1.600-1.400-2.800.3.600.9 1 1.700 1 2.800 0 3.300-3.200-1.700-7z") + '</g>',
 "i-crash": A("M9.500 8.500h13a6.500 6.500 0 0 1 6.300 5l1.500 6.200a4.200 4.200 0 0 1-7.300 3.700L21 20.500H11l-2.500 2.900a4.200 4.200 0 0 1-7.300-3.700l1.500-6.200a6.500 6.500 0 0 1 6.300-5z") + B("M8.500 12.500h2v2h2v2h-2v2h-2v-2h-2v-2h2z") + circ(22, 13.500, 1.800, "C") + circ(25.500, 17, 1.800, "C") + Cs("M11 5h4M20 5h2", 2),
 "i-fish": circ(6, 6.500, 2, "C").replace('style="fill', 'fill="none" stroke-width="1.400" style="stroke:var(--i3,#F6F1FA);fill') + circ(10.500, 3.800, 1.200, "C").replace('style="fill', 'fill="none" stroke-width="1.200" style="stroke:var(--i3,#F6F1FA);fill') +
           A("M3 17.500C7 10.500 15.500 9 22 13.500v8.600C15.500 26.500 7 25 3 17.500z") + A("M21 17.800l8.200-6.300v12.600z") + circ(9, 15.500, 1.700, "B") + Bs("M13.500 14q-1.800 3.200 0 6.400", 1.600),
 "i-sports": circ(16, 16, 12.500) + B("M16 10.800l5 3.600-1.900 5.800h-6.200L11 14.400z") + Bs("M16 10.800V4M21 14.400l6-2M19.100 20.200l3.600 5M12.900 20.200l-3.600 5M11 14.400l-6-2", 1.700),
 "i-hot": A("M16.500 2.500c.8 5.200 8.500 8.200 8.500 16.200A8.800 8.800 0 0 1 7.500 19c0-3.400 1.800-5.600 3.300-7.200.4 2 1.300 3.100 2.500 3.600-.4-5.200.8-9.800 3.200-12.900z") + B("M16 29.500a5.200 5.200 0 0 1-5.200-5.200c0-3.200 2.700-4.600 3.800-7.600 2.200 1.800 6.600 3.800 6.600 7.600A5.200 5.200 0 0 1 16 29.500z") + Cf("M16 29.500a2.600 2.600 0 0 1-2.600-2.600c0-1.800 1.300-2.500 2.600-4.200 1.300 1.700 2.600 2.400 2.600 4.200A2.600 2.600 0 0 1 16 29.500z"),
 "i-new": A("M15 2.500Q16.600 13.400 27.500 15Q16.600 16.600 15 27.500Q13.400 16.600 2.500 15Q13.400 13.400 15 2.500Z") + star(25.500, 6, 4.500) + star(25.500, 25.500, 3, "A") + circ(15, 15, 2.300, "B"),
 "i-fav": A("M16 28.500C3.500 20 3.600 9.800 9.600 6.800c3-1.400 5.600.2 6.400 2.400.8-2.200 3.400-3.800 6.400-2.400C28.400 9.800 28.500 20 16 28.500z") + Cs("M8.800 12.200a4 4 0 0 1 2.800-3.200", 1.800) + star(24.500, 5.500, 4),
 "i-all": rect(4, 4, 10.500, 10.500, 3.200) + rect(17.500, 4, 10.500, 10.500, 3.200, "C") + rect(4, 17.500, 10.500, 10.500, 3.200, "C") + rect(17.500, 17.500, 10.500, 10.500, 3.200),
}
sym = "".join('<symbol id="%s" viewBox="0 0 32 32">%s</symbol>' % (k, v) for k, v in ICONS.items())
save("icons.svg", svg("0 0 32 32", '<defs>%s</defs>%s' % (lg("rg", [(0, "#FFF3EC"), (.3, "#F7D3C4"), (.65, "#E8B4A0"), (1, "#D99A8B")]), sym), ' width="0" height="0" style="position:absolute"'))

# ===================== Logo 标记 =====================
logo = ('<defs>' + lg("bg", [(0, "#7A5BE0"), (.55, "#5B3CC4"), (1, "#C2478A")], 0, 0, 1, 1) + lg("rg", [(0, "#FFF3EC"), (.3, "#F7D3C4"), (.65, "#E8B4A0"), (1, "#D99A8B")]) + rg("gl", [(0, "#FFB59A", .55), (1, "#FFB59A", 0)], .3, .12, .7) + SPARK + '</defs>'
        '<rect width="64" height="64" rx="18" fill="url(#bg)"/><rect width="64" height="64" rx="18" fill="url(#gl)"/>'
        '<rect x="2.500" y="2.500" width="59" height="59" rx="15.500" fill="none" stroke="url(#rg)" stroke-opacity=".55"/>'
        '<path d="M8 56q6-5 12 0t12 0 12 0 12 0" fill="none" stroke="#F7D3C4" stroke-opacity=".28" stroke-width="1.4"/>'
        '<g fill="none" stroke-width="5.500"><circle cx="32" cy="21.500" r="7.500" stroke="url(#rg)"/><circle cx="32" cy="39.500" r="10.500" stroke="url(#rg)"/></g>'
        '<path d="M32 29v1.600" stroke="#C2478A" stroke-width="3.500"/><use href="#sp" transform="translate(47 14) scale(5.500)" fill="#FFF3EC"/><use href="#sp" transform="translate(16 12) scale(2.400)" fill="#F7D3C4" opacity=".85"/>')
save("logo-mark.svg", svg("0 0 64 64", logo))

# ===================== 图案 / 分隔 / 边框 =====================
save("pattern-wave.svg", svg("0 0 48 16", '<g fill="none" stroke="#F7D3C4" stroke-width="1" stroke-linecap="round"><path d="M0 5Q6-1 12 5T24 5 36 5 48 5" stroke-opacity=".22"/><path d="M0 13Q6 7 12 13T24 13 36 13 48 13" stroke-opacity=".14"/></g><circle cx="12" cy="9" r=".8" fill="#F7D3C4" fill-opacity=".25"/><circle cx="36" cy="1" r=".8" fill="#F7D3C4" fill-opacity=".25"/>', ' width="48" height="16"'))
cloud = '<g fill="none" stroke="#F7D3C4" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.100"><path d="M6 36c-4 0-5-8 1.500-9.500C8 20 17 17.500 20.500 22c2.400-5.500 12-4.600 13 2.500 5-.8 8.500 5.500 3.500 9.500-.8.700-1.800 1.200-3 1.200H10"/><path d="M15 27c3-1 5 1.500 3.500 3.500M26 25.500c3 0 4.500 2.500 3 4.500"/><path d="M38 37c5 0 8 3 6 5.500s-5.500 1-4-1"/></g>'
save("pattern-cloud.svg", svg("0 0 96 64", cloud + '<g transform="translate(48 30)" opacity=".7">' + cloud + '</g>', ' width="96" height="64"'))
sparks = "".join('<use href="#sp" transform="translate(%s %s) scale(%s)" fill="%s" fill-opacity="%s"/>' % (x, y, s, c, o) for x, y, s, c, o in [(18, 22, 3, "#F7D3C4", .55), (92, 46, 2, "#fff", .5), (130, 12, 1.600, "#FFB59A", .6), (52, 90, 1.800, "#fff", .45), (112, 108, 3.200, "#F7D3C4", .5), (24, 130, 1.500, "#fff", .5), (72, 54, 1.100, "#fff", .5), (140, 76, 1.200, "#F7D3C4", .5)])
save("pattern-sparkle.svg", svg("0 0 150 150", '<defs>' + SPARK + '</defs>' + sparks, ' width="150" height="150"'))
save("divider.svg", svg("0 0 320 20", '<defs>' + lg("l", [(0, "#E8B4A0", 0), (1, "#F7D3C4", .95)], 0, 0, 1, 0) + lg("r", [(0, "#F7D3C4", .95), (1, "#E8B4A0", 0)], 0, 0, 1, 0) + SPARK + '</defs>'
        '<path d="M8 10H138" stroke="url(#l)" stroke-width="1.200"/><path d="M182 10H312" stroke="url(#r)" stroke-width="1.200"/><path d="M142 10l8-4M178 10l-8-4M142 10l8 4M178 10l-8 4" stroke="#F7D3C4" stroke-opacity=".7" stroke-width="1" fill="none"/>'
        '<path d="M160 3.500L166.500 10 160 16.500 153.500 10Z" fill="#F7D3C4"/><path d="M160 6.500L163.500 10 160 13.500 156.500 10Z" fill="#C2478A"/><circle cx="133" cy="10" r="1.800" fill="#F7D3C4"/><circle cx="187" cy="10" r="1.800" fill="#F7D3C4"/><use href="#sp" transform="translate(112 10) scale(3.500)" fill="#FFF3EC" opacity=".8"/><use href="#sp" transform="translate(208 10) scale(3.500)" fill="#FFF3EC" opacity=".8"/>'))
save("frame-corner.svg", svg("0 0 28 28", '<defs>' + lg("g", [(0, "#FFF3EC"), (1, "#D99A8B")], 0, 0, 1, 1) + '</defs><path d="M2 27V9a7 7 0 0 1 7-7h18" fill="none" stroke="url(#g)" stroke-width="1.600" stroke-linecap="round"/><path d="M6 21V10.500A4.500 4.500 0 0 1 10.500 6H21" fill="none" stroke="#F7D3C4" stroke-opacity=".4" stroke-width="1"/><path d="M2 2l2.600 2.600L2 7.200-.6 4.600z" fill="#FFF3EC"/>', ' width="28" height="28"'))
save("loader-ring.svg", svg("0 0 64 64", '<defs>' + lg("g", [(0, "#F7D3C4", 0), (1, "#FFF3EC")], 0, 0, 1, 1) + SPARK + '</defs><circle cx="32" cy="32" r="28" fill="none" stroke="#F7D3C4" stroke-opacity=".18" stroke-width="3"/><path d="M32 4A28 28 0 0 1 60 32" fill="none" stroke="url(#g)" stroke-width="3.500" stroke-linecap="round"/><use href="#sp" transform="translate(60 32) scale(5)" fill="#fff"/>', ' width="64" height="64"'))

# ===================== 空状态 =====================
def emp(inner):
    return svg("0 0 160 120", '<defs>' + lg("rg", [(0, "#FFF3EC"), (.3, "#F7D3C4"), (.65, "#E8B4A0"), (1, "#D99A8B")]) + lg("cl", [(0, "#fff", .22), (1, "#fff", .04)]) + rg("gl", [(0, "#FFB59A", .35), (1, "#7A5BE0", 0)]) + SPARK + '</defs><ellipse cx="80" cy="64" rx="70" ry="50" fill="url(#gl)"/><path d="M20 98c-9 0-10-12 1-14 0-9 13-12 18-5 4-8 20-6 21 5 8-1 11 11 2 14z" fill="url(#cl)"/><path d="M100 104c-7 0-8-9 1-11 0-7 10-9 14-4 3-6 15-5 16 4 6-1 8 8 1 11z" fill="url(#cl)"/>' + inner)
spk = '<use href="#sp" transform="translate(30 34) scale(5)" fill="#FFE9C7"/><use href="#sp" transform="translate(132 28) scale(4)" fill="#fff"/><use href="#sp" transform="translate(140 80) scale(3)" fill="#F7D3C4"/><use href="#sp" transform="translate(18 72) scale(2.500)" fill="#fff" opacity=".8"/>'
save("empty-search.svg", emp(spk + '<circle cx="74" cy="52" r="26" fill="#2B1B5E" fill-opacity=".35" stroke="url(#rg)" stroke-width="7"/><path d="M93 71l20 20" stroke="url(#rg)" stroke-width="9" stroke-linecap="round"/><path d="M60 46a15 15 0 0 1 11-10" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/><path d="M66 58q8-6 16 0" fill="none" stroke="#F7D3C4" stroke-width="3" stroke-linecap="round"/><circle cx="67" cy="49" r="2.200" fill="#F7D3C4"/><circle cx="81" cy="49" r="2.200" fill="#F7D3C4"/>'))
save("empty-fav.svg", emp(spk + '<path d="M80 98C46 76 46 48 63 41c8-3.500 14 .5 17 6 3-5.500 9-9.500 17-6 17 7 17 35-17 57z" fill="#2B1B5E" fill-opacity=".3" stroke="url(#rg)" stroke-width="5" stroke-linejoin="round" stroke-dasharray="3 9" stroke-linecap="round"/><path d="M80 66v14M73 73h14" stroke="url(#rg)" stroke-width="5" stroke-linecap="round"/>'))
save("empty-error.svg", emp(spk + '<circle cx="80" cy="58" r="30" fill="#2B1B5E" fill-opacity=".35" stroke="url(#rg)" stroke-width="6"/><path d="M80 40v22" stroke="url(#rg)" stroke-width="7" stroke-linecap="round"/><circle cx="80" cy="74" r="4" fill="#F7D3C4"/><path d="M104 38l-8 12 8 4-6 12" fill="none" stroke="#C2478A" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'))
