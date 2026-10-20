#!/usr/bin/env python3
"""이야기 그림 조립 — game-assets-src/raw/pt_<who>_<ex>.png · bus_<n>.png(GPT 웹 → Firefly 원화) → 오리기(cutout-flood)
   → public/story/portraits/<who>_<ex>.webp(320²) · public/story/bus/bus_<n>.webp(240×180). 원화·원장(_engine.json)은 game-assets-src 에 남는다.
   python3 tools/build-story-art.py"""
import subprocess, sys
from pathlib import Path
from PIL import Image
R = Path(__file__).resolve().parents[1]
RAW, TMP = R / 'game-assets-src/raw', R / 'game-assets-src/cut'
CUT = Path.home() / '.claude/skills/game-builder/tools/cutout-flood.py'
POUT, BOUT = R / 'public/story/portraits', R / 'public/story/bus'
for d in (TMP, POUT, BOUT): d.mkdir(parents=True, exist_ok=True)
def cut(src, dst, spec, anchor):
  r = subprocess.run([sys.executable, str(CUT), '--spec', spec, '--pad', '0.03', '--anchor', anchor, f'{src}:{dst}'], capture_output=True, text=True)
  if r.returncode: print('❌ 오리기 실패', src.name, r.stdout[-200:]); sys.exit(1)
n = 0
for f in sorted(RAW.glob('pt_*.png')):
  c = TMP / f.name; cut(f, c, '640x640', 'bottom')
  Image.open(c).resize((320, 320), Image.LANCZOS).save(POUT / f'{f.stem[3:]}.webp', 'WEBP', quality=84, method=6); n += 1
for f in sorted(RAW.glob('bus_*.png')):
  c = TMP / f.name; cut(f, c, '800x600', 'center')
  Image.open(c).resize((240, 180), Image.LANCZOS).save(BOUT / f'{f.stem}.webp', 'WEBP', quality=84, method=6); n += 1
print(f'이야기 그림 {n}장')
