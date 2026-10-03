"""由 app.css / tokens.css / art.css 里的「flex + gap」与「aspect-ratio」规则自动生成旧内核回退样式 → public/css/compat.css
仅在 boot.js 检测到不支持 flex-gap（iOS < 14.5）/ aspect-ratio（iOS < 15 / Android WebView < 88）时才被加载，现代浏览器零开销。"""
import re, os
D = os.path.join(os.path.dirname(__file__), "..", "public", "css")
gap = []
for f in ("tokens.css", "app.css", "art.css", "lobby.css"):
    s = open(os.path.join(D, f)).read()
    s = re.sub(r"/\*.*?\*/", "", s, flags=re.S)
    # 去掉 @media / @supports 块(含嵌套花括号)，只处理顶层规则；媒体查询内的 gap 另有处理
    def strip_at(t):
        out, i = "", 0
        while i < len(t):
            if t[i] == "@" and re.match(r"@(media|supports)", t[i:]):
                j = t.index("{", i); depth = 1; j += 1
                while depth: depth += (t[j] == "{") - (t[j] == "}"); j += 1
                i = j
            else: out += t[i]; i += 1
        return out
    s = strip_at(s)
    # 展平 @media：只处理顶层规则（媒体查询内的 gap 极少）
    for m in re.finditer(r"(?<![\w-])([^{}@;]+)\{([^{}]*)\}", s):
        sel, body = m.group(1).strip(), m.group(2)
        if not sel or sel.startswith("@") or sel[0] in "0123456789": continue
        g = re.search(r"(?:^|;)gap:\s*(\d+(?:\.\d+)?)px", body)
        if g and re.search(r"display:\s*(inline-)?flex", body):
            col = re.search(r"flex-direction:\s*column", body) is not None
            gap.append((sel, g.group(1), col))

out = ["/* 自动生成：python3 scripts/build-compat.py。flex-gap 回退(.no-fg) 与 aspect-ratio 回退(.no-ar) */"]
for sel, v, col in gap:
    sels = [x.strip() for x in sel.split(",")]
    prop = "margin-top" if col else "margin-left"
    out.append(",".join(".no-fg %s>*+*" % x for x in sels) + "{%s:%spx}" % (prop, v))
# 特例：tabs 按钮里文本节点无法选中 → 图标右边距
out.append(".no-fg .catbar .tabs button>svg,.no-fg .chip>svg{margin-right:6px}.no-fg .bdg>svg{margin-right:4px}.no-fg .btn>svg{margin-right:8px}")
# aspect-ratio 回退（手工列表：这些容器的子元素均为绝对定位或自带高度）
out.append(".no-ar .cv{height:0;padding-top:100%}.no-ar .skel{height:0;padding-top:134%}")
out.append(".no-ar .vid{height:auto}.no-ar .vid:before{content:\"\";display:block;padding-top:56.25%}")
s = "\n".join(out)
open(os.path.join(D, "compat.css"), "w").write(s)
print("compat.css %d B, %d gap rules, aspect: manual" % (len(s.encode()), len(gap)))
