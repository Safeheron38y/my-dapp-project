"""自托管字体子集（OFL）→ public/assets/fonts/*.woff2。需要 fonttools + brotli。
源字体（google/fonts 仓库, SIL OFL 1.1）放在 FONTSRC（默认 /workspace/fontsrc）：
  notoserifsc/NotoSerifSC[wght].ttf, cormorantgaramond/CormorantGaramond[wght].ttf + -Italic[wght].ttf, marcellussc/MarcellusSC-Regular.ttf
CJK 只保留界面实际用到的字（public/*.html、public/js/*.js、游戏目录名称），其余字符由系统宋体/衬线回退（unicode-range 不设限，浏览器逐字回退）。
用法：python scripts/build-fonts.py"""
import os, re, glob, json, shutil, sys
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.environ.get("FONTSRC", "/workspace/fontsrc")
OUT = os.path.join(ROOT, "public", "assets", "fonts"); os.makedirs(OUT, exist_ok=True)
ASCII = "".join(chr(c) for c in range(0x20, 0x7f))
PUNCT = "·…—–‘’“”，。、；：？！（）《》「」【】￥¥›‹×←→↑↓★☆♠♥♦♣％＋－／～　"
txt = ""
for f in glob.glob(os.path.join(ROOT, "public", "*.html")) + glob.glob(os.path.join(ROOT, "public", "js", "*.js")):
    t = open(f, encoding="utf-8").read()
    t = re.sub(r"/\*.*?\*/|<!--.*?-->", "", t, flags=re.S); t = re.sub(r"(^|[;{}),])\s*//[^\n]*", r"\1", t, flags=re.M)  # 注释里的字不需要
    txt += t
for f in glob.glob(os.path.join(ROOT, "server", "config", "*.json")):
    try: txt += open(f, encoding="utf-8").read()
    except Exception: pass
cjk = sorted(set(ch for ch in txt if ord(ch) > 0x2e7f))
full = ASCII + PUNCT + "".join(cjk)
# 900 字重仅用于横幅大标题与登录/注册标题
HEAVY = ASCII + PUNCT + "月门迎福玉满堂真人视讯百家乐老虎机麻将精选深海捕鱼赢大奖欢迎回来创建账号演示"

def build(src, out, text, wght=None, ital=None):
    f = TTFont(src)
    if "fvar" in f and wght is not None:
        f = instancer.instantiateVariableFont(f, {"wght": wght})
    opts = subset.Options(); opts.flavor = "woff2"; opts.layout_features = ["kern", "liga", "locl", "palt", "vpal", "lnum", "tnum", "onum", "pnum"]; opts.name_IDs = [0, 1, 2, 3, 4, 5, 6, 13, 14]
    opts.notdef_outline = True; opts.hinting = False; opts.desubroutinize = True
    s = subset.Subsetter(opts); s.populate(text=text); s.subset(f)
    p = os.path.join(OUT, out); f.flavor = "woff2"; f.save(p); print(out, os.path.getsize(p) // 1024, "KB", len(text), "chars")

N = os.path.join(SRC, "notoserifsc", "NotoSerifSC[wght].ttf")
build(N, "noto-serif-sc-500.woff2", full, 500)
build(N, "noto-serif-sc-700.woff2", full, 700)
build(N, "noto-serif-sc-900.woff2", HEAVY, 900)
LAT = ASCII + "·…—–‘’“”¥›‹×€£"
build(os.path.join(SRC, "cormorantgaramond", "CormorantGaramond[wght].ttf"), "cormorant-garamond-600.woff2", LAT, 600)
build(os.path.join(SRC, "cormorantgaramond", "CormorantGaramond-Italic[wght].ttf"), "cormorant-garamond-500i.woff2", LAT, 500)
build(os.path.join(SRC, "marcellussc", "MarcellusSC-Regular.ttf"), "marcellus-sc.woff2", LAT)
for d, n in (("notoserifsc", "OFL-NotoSerifSC.txt"), ("cormorantgaramond", "OFL-CormorantGaramond.txt"), ("marcellussc", "OFL-MarcellusSC.txt")):
    shutil.copy(os.path.join(SRC, d, "OFL.txt"), os.path.join(OUT, n))
