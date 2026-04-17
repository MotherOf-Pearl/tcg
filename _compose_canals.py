"""
Compose The Canals card from Canals art + OP01-090 Schola Montis Belli template.
Produces ST04/ST04-017.png matching the Anna of Brittany stage card look.
"""
from PIL import Image, ImageDraw, ImageFont
import os, textwrap

REPO = r"C:\Users\jackb\Downloads\OPTCG\tcg_repo"
ASSETS = r"C:\Users\jackb\OneDrive\Desktop\BoohawTCG"

template = Image.open(os.path.join(REPO, "OP01", "OP01-090.png")).convert("RGBA")
art = Image.open(os.path.join(ASSETS, "Constable Jack", "Canals.png")).convert("RGBA")

W, H = template.size  # 480, 671
print(f"template: {W}x{H}")

# Art region in template (under the top banner, above the ability block)
ART_X1, ART_Y1, ART_X2, ART_Y2 = 36, 126, 444, 440

# Resize art to fit region (preserving aspect, then crop center)
region_w = ART_X2 - ART_X1
region_h = ART_Y2 - ART_Y1
src_w, src_h = art.size
scale = max(region_w / src_w, region_h / src_h)
new_w = int(src_w * scale)
new_h = int(src_h * scale)
art_resized = art.resize((new_w, new_h), Image.LANCZOS)
# Center-crop to region size
crop_x = (new_w - region_w) // 2
crop_y = (new_h - region_h) // 2
art_cropped = art_resized.crop((crop_x, crop_y, crop_x + region_w, crop_y + region_h))

# Paste art into template (under the frame)
canvas = template.copy()
canvas.paste(art_cropped, (ART_X1, ART_Y1))

# Re-apply template layers ABOVE the art by pasting only text/decoration regions back.
# Simplest: paste original template back over, then overwrite our known text regions.
# (We want the template's border/cost-circle/banner/name-plate intact, just the center art replaced.)
canvas = Image.alpha_composite(canvas, template.copy())
# That's wrong — alpha_composite puts the original art back on top. Use masked approach instead.

# Better: composite the template frame (minus art region) on top of the new art.
# Build a "frame only" image: template with art region erased.
frame_only = template.copy()
transparent = Image.new("RGBA", (region_w, region_h), (0, 0, 0, 0))
frame_only.paste(transparent, (ART_X1, ART_Y1))

# Rebuild canvas: start with art in the middle, then overlay frame_only on top
canvas = Image.new("RGBA", (W, H), (0, 0, 0, 0))
canvas.paste(art_cropped, (ART_X1, ART_Y1))
canvas = Image.alpha_composite(canvas, frame_only)

# ─── OVERWRITE TEXT REGIONS ───
draw = ImageDraw.Draw(canvas)

FONT_DIR = r"C:\Windows\Fonts"
def font(name, size):
    return ImageFont.truetype(os.path.join(FONT_DIR, name), size)

f_cost    = font("constanb.ttf", 26)
f_banner  = font("constanb.ttf", 16)
f_ability = font("constan.ttf",  14)
f_stage   = font("constanb.ttf", 12)
f_name    = font("constanb.ttf", 24)

# 1. Cost circle (top-left): black circle bg, gold "3"
COST_CENTER = (56, 56)
COST_RADIUS = 26
draw.ellipse(
    [COST_CENTER[0]-COST_RADIUS, COST_CENTER[1]-COST_RADIUS,
     COST_CENTER[0]+COST_RADIUS, COST_CENTER[1]+COST_RADIUS],
    fill=(20, 14, 6, 255),
)
# Center "3"
txt = "3"
bbox = draw.textbbox((0, 0), txt, font=f_cost)
tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
draw.text(
    (COST_CENTER[0] - tw/2 - bbox[0], COST_CENTER[1] - th/2 - bbox[1]),
    txt, font=f_cost, fill=(230, 190, 80, 255),
)

# 2. Top banner (affiliation): "Animal Kingdom Pirates" — slightly taller to cover the old "Duchess of Brittany" text beneath.
BANNER_X1, BANNER_Y1, BANNER_X2, BANNER_Y2 = 100, 85, 380, 128
draw.rounded_rectangle(
    [BANNER_X1, BANNER_Y1, BANNER_X2, BANNER_Y2],
    radius=14, fill=(30, 22, 10, 235), outline=(180, 140, 50, 255), width=1,
)
txt = "Animal Kingdom Pirates"
bbox = draw.textbbox((0, 0), txt, font=f_banner)
tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
draw.text(
    ((BANNER_X1+BANNER_X2)/2 - tw/2 - bbox[0],
     (BANNER_Y1+BANNER_Y2)/2 - th/2 - bbox[1]),
    txt, font=f_banner, fill=(240, 220, 170, 255),
)

# 3. Ability text block (dark translucent rectangle)
ABIL_X1, ABIL_Y1, ABIL_X2, ABIL_Y2 = 44, 450, 436, 565
draw.rounded_rectangle(
    [ABIL_X1, ABIL_Y1, ABIL_X2, ABIL_Y2],
    radius=6, fill=(20, 14, 6, 230), outline=(160, 120, 50, 180), width=1,
)
ability_text = (
    "[Activate: Main] You may rest this Stage: If your Leader "
    "has the {Animal Kingdom Pirates} type, add up to 1 DON!! "
    "card from your DON!! deck and rest it."
)
# Wrap to width
inner_w = ABIL_X2 - ABIL_X1 - 16
# Rough char-width → width-based wrapping using textbbox
def wrap_to_width(text, f, max_width):
    words = text.split()
    lines, cur = [], ""
    for w in words:
        trial = (cur + " " + w).strip()
        bb = f.getbbox(trial)
        if bb[2] - bb[0] <= max_width:
            cur = trial
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    return lines

lines = wrap_to_width(ability_text, f_ability, inner_w)
y = ABIL_Y1 + 10
line_h = 18
for ln in lines:
    draw.text((ABIL_X1 + 10, y), ln, font=f_ability, fill=(245, 235, 210, 255))
    y += line_h

# 4. Type label: "STAGE" in small pill
TYPE_CX, TYPE_CY = W // 2, 585
draw.rounded_rectangle(
    [TYPE_CX-42, TYPE_CY-12, TYPE_CX+42, TYPE_CY+12],
    radius=10, fill=(60, 40, 14, 255), outline=(180, 140, 50, 255), width=1,
)
txt = "STAGE"
bbox = draw.textbbox((0, 0), txt, font=f_stage)
tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
draw.text(
    (TYPE_CX - tw/2 - bbox[0], TYPE_CY - th/2 - bbox[1]),
    txt, font=f_stage, fill=(240, 220, 170, 255),
)

# 5. Name banner at bottom
NAME_X1, NAME_Y1, NAME_X2, NAME_Y2 = 40, 610, 440, 655
draw.rounded_rectangle(
    [NAME_X1, NAME_Y1, NAME_X2, NAME_Y2],
    radius=6, fill=(60, 40, 14, 255), outline=(180, 140, 50, 255), width=1,
)
txt = "The Canals"
bbox = draw.textbbox((0, 0), txt, font=f_name)
tw, th = bbox[2]-bbox[0], bbox[3]-bbox[1]
draw.text(
    ((NAME_X1+NAME_X2)/2 - tw/2 - bbox[0],
     (NAME_Y1+NAME_Y2)/2 - th/2 - bbox[1]),
    txt, font=f_name, fill=(245, 235, 210, 255),
)

out = os.path.join(REPO, "ST04", "ST04-017.png")
canvas.convert("RGB").save(out, "PNG", optimize=True)
print(f"wrote {out}")
