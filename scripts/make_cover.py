# -*- coding: utf-8 -*-
"""生成抖音主页封面（竖屏 1080x1920），突出「资源在哪」。"""
import random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H = 1080, 1920
random.seed(42)

# ---------- 颜色 ----------
def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

TOP = (9, 14, 38)       # 深蓝黑
BOT = (28, 18, 72)      # 紫
CYAN = (94, 234, 212)   # 青绿高亮
GOLD = (255, 209, 102)  # 金黄
WHITE = (255, 255, 255)
SUB = (168, 180, 214)   # 灰蓝

# ---------- 字体 ----------
def font(size, bold=False):
    path = "C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"
    return ImageFont.truetype(path, size)

F_TAG   = font(30, True)
F_BIG   = font(132, True)
F_SUB   = font(52)
F_BRAND = font(76, True)
F_CARD  = font(40, True)
F_URL   = font(34)
F_TIP   = font(46, True)
F_SMALL = font(36)
F_HASH  = font(32)

def text_w(draw, txt, f):
    b = draw.textbbox((0, 0), txt, font=f)
    return b[2] - b[0]

def center(draw, y, txt, f, fill, stroke=0, stroke_fill=None):
    x = (W - text_w(draw, txt, f)) / 2
    draw.text((x, y), txt, font=f, fill=fill,
              stroke_width=stroke, stroke_fill=stroke_fill)

# ---------- 背景渐变 ----------
img = Image.new("RGB", (W, H), TOP)
d = ImageDraw.Draw(img)
for y in range(H):
    d.line([(0, y), (W, y)], fill=lerp(TOP, BOT, y / H))

# ---------- 星点 ----------
stars = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(stars)
for _ in range(180):
    x = random.randint(0, W)
    y = random.randint(0, H)
    r = random.choice([1, 1, 2, 2, 3])
    a = random.randint(60, 200)
    sd.ellipse([x - r, y - r, x + r, y + r], fill=(200, 230, 255, a))
img = Image.alpha_composite(img.convert("RGBA"), stars)

# ---------- 光晕 ----------
glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse([W/2 - 320, 300, W/2 + 320, 940], fill=(78, 60, 190, 90))
gd.ellipse([W/2 - 260, 1180, W/2 + 260, 1700], fill=(40, 160, 170, 70))
glow = glow.filter(ImageFilter.GaussianBlur(120))
img = Image.alpha_composite(img, glow)

d = ImageDraw.Draw(img)

# ---------- 顶部标签 ----------
tag = "开源免费  ·  零依赖  ·  断网可用"
tw = text_w(d, tag, F_TAG)
pad = 26
d.rounded_rectangle([(W-tw)/2-pad, 150, (W+tw)/2+pad, 216], radius=33,
                    fill=(30, 45, 90), outline=CYAN, width=2)
center(d, 163, tag, F_TAG, CYAN)

# ---------- 主标题 ----------
center(d, 300, "AI 记忆插件", F_BIG, WHITE, stroke=3, stroke_fill=(40, 30, 90))
center(d, 470, "让 AI 真正「记得你」", F_SUB, SUB)

# ---------- 品牌名 ----------
center(d, 620, "Nebula Memory", F_BRAND, CYAN)

# ---------- 主卡片：资源在哪 ----------
cx0, cx1 = 90, W - 90
d.rounded_rectangle([cx0, 780, cx1, 1090], radius=32,
                    fill=(16, 24, 56), outline=GOLD, width=3)
center(d, 812, "资源清单在这里", F_CARD, GOLD)
center(d, 890, "github.com/yb-zhai", F_URL, WHITE)
center(d, 940, "/agent-memory", F_URL, WHITE)
d.line([(cx0+70, 1000), (cx1-70, 1000)], fill=(70, 90, 140), width=2)
center(d, 1014, "仓库地址", F_SMALL, SUB)

# ---------- 醒目提示条 ----------
d.rounded_rectangle([cx0, 1150, cx1, 1270], radius=30, fill=CYAN)
center(d, 1178, "主页置顶 = 完整资源清单", F_TIP, (10, 20, 40))

# ---------- 副信息 ----------
center(d, 1330, "搜 nebula-memory 就能找到", F_SMALL, WHITE)
center(d, 1392, "Claude / Cursor / DSH 都能接", F_SMALL, SUB)

# ---------- 底部关键词 ----------
hashes = ["#AI记忆", "#MCP", "#开源项目", "#效率工具"]
y0 = 1600
x = 70
for h in hashes:
    w = text_w(d, h, F_HASH) + 34
    if x + w > W - 40:
        x = 70
        y0 += 70
    d.rounded_rectangle([x, y0, x + w, y0 + 56], radius=28,
                        fill=(30, 45, 90), outline=(70, 90, 140), width=1)
    d.text((x + 17, y0 + 10), h, font=F_HASH, fill=(190, 205, 235))
    x += w + 20

# ---------- 底部提示：资源清单链接在评论区 ----------
center(d, 1760, "详细清单链接在评论区", F_TIP, GOLD)

out = "E:/DSHN/build/DSH-memory-nebula/docs/cover-douyin.png"
img.convert("RGB").save(out, "PNG", quality=95)
print("saved:", out, img.size)
