"""Regenerate share artwork with Python + Pillow (not required to build the app)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'public'
OUT.mkdir(exist_ok=True)
BG, PANEL, LIME, PURPLE, WHITE = '#14151d', '#252631', '#c2ff8a', '#bba4ff', '#f3f2f8'
S = 2

def font(size, bold=False):
    names = (['/System/Library/Fonts/Supplemental/Arial Bold.ttf', 'DejaVuSans-Bold.ttf']
             if bold else ['/System/Library/Fonts/Supplemental/Arial.ttf', 'DejaVuSans.ttf'])
    for name in names:
        try:
            return ImageFont.truetype(name, size * S)
        except OSError:
            pass
    raise RuntimeError('Install Arial or DejaVu Sans to regenerate artwork.')

# Simple vector mark remains crisp even at favicon sizes.
(OUT / 'favicon.svg').write_text('''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="16" fill="#14151d"/>
  <path d="M15 12h34a7 7 0 0 1 7 7v26a7 7 0 0 1-7 7H29L16 60v-8h-1a7 7 0 0 1-7-7V19a7 7 0 0 1 7-7Z" fill="#c2ff8a"/>
  <g fill="#14151d"><rect x="17" y="26" width="6" height="12" rx="3"/><rect x="29" y="20" width="6" height="24" rx="3"/><rect x="41" y="24" width="6" height="16" rx="3"/></g>
</svg>
''')

def icon(size):
    im = Image.new('RGB', (512, 512), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle((64, 96, 448, 416), radius=56, fill=LIME)
    d.polygon([(128, 400), (128, 480), (240, 400)], fill=LIME)
    for x, y, h in [(136, 208, 96), (232, 160, 192), (328, 192, 128)]:
        d.rounded_rectangle((x, y, x+48, y+h), radius=24, fill=BG)
    return im.resize((size, size), Image.Resampling.LANCZOS)

icon(256).save(OUT / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
icon(180).save(OUT / 'apple-touch-icon.png')
im = Image.new('RGB', (1200*S, 630*S), BG)
d = ImageDraw.Draw(im)
def box(x, y, w, h, color, r=12):
    d.rounded_rectangle((x*S, y*S, (x+w)*S, (y+h)*S), radius=r*S, fill=color)
def text(x, y, value, size, color=WHITE, bold=False):
    d.text((x*S, y*S), value, font=font(size, bold), fill=color)

im.paste(icon(64*S), (60*S, 52*S))
text(140, 65, 'beat telephone', 33, bold=True)
text(62, 172, 'Silly prompts.', 68, bold=True)
text(62, 250, 'Serious beats.', 68, LIME, True)
text(64, 358, 'Make a song. Surprise your friends.', 26)
text(64, 400, 'No musical experience required.', 23, '#b5b4c7')
box(64, 514, 246, 48, PANEL, 24)
text(85, 525, '2–8 friends • Play free', 20, LIME, True)
text(64, 589, 'beatphone.xyz', 17, '#b5b4c7')
# A playful miniature arrangement: drums, piano notes, and a vocal waveform.
box(744, 152, 400, 360, PANEL, 24)
text(770, 179, 'YOUR NEXT HIT', 17, '#b5b4c7', True)
for row, color in enumerate([LIME, PURPLE, '#ffb38a']):
    for col in range(8):
        active = (col + row*2) % (row+2) == 0 or col == 6-row
        box(771 + col*43, 228 + row*40, 34, 27, color if active else '#373845', 5)
for x, y, w in [(772,366,70),(852,350,108),(972,366,70),(1054,341,60)]:
    box(x,y,w,13,PURPLE,4)
for i, h in enumerate([10,18,30,16,42,56,24,36,16,46,60,32,18,40,24,12,28,46,20,10,30,50,24,12,20,34,14,8]):
    box(773+i*12, 449-h/2, 6, h, LIME, 3)
box(738, 490, 265, 47, PURPLE, 14)
text(758, 502, 'One prompt. Your sound.', 20, BG, True)
im.resize((1200, 630), Image.Resampling.LANCZOS).save(OUT / 'social-preview-v1.png', optimize=True)
