"""Cut the making-of documentary: it opens cold on gameplay, then tells the build chapter by chapter, each chapter
followed by the gameplay it made possible, and ends on a gameplay montage and the credits. Menu music under the
making-of, race music (and the game's own engine and crash sound) under the gameplay.

Public-safe by construction:
  * stills come only from the ALLOW list below (our tracks, our generator previews, our editor and game screens):
    nothing from the 1990 original (screens, bitmaps, track layouts, music, its name or its file names) can slip in,
    and the replay viewer's footage of the original's drives stays out;
  * gameplay is recorded by scripts/record.mjs on the capture scene, which only loads our bundled tracks;
  * the text says only "Car Smash Stunt Tracks" and describes the original generically.

    re/.venv/bin/python -I scripts/documentary.py <repo root> [--base http://127.0.0.1:5308] [--gpu]
        -> test-results/documentary/documentary.mp4

Needs the dev server (the capture scene). Clips are cached in test-results/video/clips/ by content.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

W, H = 1280, 720
BAR = 1.6  # a bar of the race song (150 bpm): gameplay cuts land on it
NOTO = Path('/usr/share/fonts/truetype/noto')
BG = (11, 14, 28)
ACCENT = (255, 90, 31)
YELLOW = (255, 210, 63)
CYAN = (53, 214, 255)


def font(name, size):
    return ImageFont.truetype(str(NOTO / name), size)


F_BOLD = lambda s: font('NotoSans-Regular.ttf', s)
F_TEXT = lambda s: font('NotoSans-Light.ttf', s)
F_MONO = lambda s: font('NotoSansMono-Regular.ttf', s)


# ---- generated cards (PNG, used as stills) ----------------------------------------------------------------------

def terminal(title, lines):
    """Our own tools' output on a dark terminal panel (generic wording: no file names of the original)."""
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((80, 50), title, font=F_BOLD(30), fill=ACCENT)
    d.rounded_rectangle((70, 110, W - 70, H - 60), 14, fill=(6, 8, 14), outline=(50, 60, 80), width=2)
    y = 135
    for ln in lines[:20]:
        d.text((95, y), ln, font=F_MONO(22), fill=(150, 230, 160) if ln.startswith('ok') else (210, 215, 225))
        y += 26
    return im


def bars(title, rows, unit, note=None):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((80, 60), title, font=F_BOLD(32), fill=(240, 240, 240))
    y = 150
    for label, v, mx in rows:
        d.text((80, y + 4), label, font=F_MONO(24), fill=(200, 205, 215))
        x0, x1 = 360, W - 240
        d.rectangle((x0, y, x1, y + 34), fill=(30, 36, 48))
        d.rectangle((x0, y, x0 + (x1 - x0) * v / mx, y + 34), fill=CYAN if v == mx else ACCENT)
        d.text((x1 + 16, y + 4), f'{v}/{mx} {unit}', font=F_MONO(22), fill=(220, 220, 220))
        y += 62
    if note:
        d.text((80, H - 90), note, font=F_TEXT(24), fill=(170, 178, 190))
    return im


def feedback_rows(repo):
    text = re.sub(r'<!--.*?-->', '', (repo / 'FEEDBACK.md').read_text(), flags=re.S)
    rows = []
    for m in re.finditer(r'^## (CS-FB-\d+) · (.+?)\n(.*?)(?=^## |\Z)', text, flags=re.S | re.M):
        st = re.search(r'- Status: (\w+)', m.group(3))
        rows.append((m.group(1), m.group(2)[:68], st.group(1) if st else '?'))
    return rows


def feedback_card(rows):
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    d.text((80, 44), f'{len(rows)} findings sent back to the generator', font=F_BOLD(32), fill=(240, 240, 240))
    colour = {'verified': (110, 220, 130), 'fixed': CYAN, 'triaged': YELLOW, 'open': (230, 110, 100)}
    y = 112
    for fid, title, st in rows[-20:]:
        d.text((80, y), fid, font=F_MONO(19), fill=(150, 158, 175))
        d.text((230, y), title, font=F_TEXT(20), fill=(220, 222, 228))
        d.text((W - 190, y), st, font=F_BOLD(20), fill=colour.get(st, (200, 200, 200)))
        y += 29
    return im


def qa_card(repo, probe):
    """The polish chapter's card: the QA lane's issue list if it is in master, else our own smoothness measurements."""
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    qa = Path('/home/andrew/projects/4dstunts/docs/QA.md')
    if not qa.exists():
        qa = repo / 'docs' / 'QA.md'
    if qa.exists():
        items = [re.sub(r'[`*_]', '', m.group(1)).strip() for m in re.finditer(r'^(?:##+|- \[.\]|-) (.+)$', qa.read_text(), flags=re.M)]
        items = [i for i in items if not re.search(r'tony', i, flags=re.I)][:16]
        d.text((80, 44), 'The polish list', font=F_BOLD(32), fill=(240, 240, 240))
        y = 110
        for it in items:
            d.text((90, y), '·  ' + it[:90], font=F_TEXT(22), fill=(215, 220, 230))
            y += 33
        return im
    d.text((80, 36), 'Hunting judder: every frame through the loop, measured', font=F_BOLD(30), fill=(240, 240, 240))
    d.text((80, 80), 'Lagoon Leap loop, 60 frames a second, from frame-exact captures', font=F_TEXT(22), fill=(160, 168, 185))

    def graph(top, h, label, series):
        x0, x1 = 90, W - 90
        d.rectangle((x0, top, x1, top + h), fill=(16, 20, 34))
        mx = max(max(v) for _, v, _ in series if v) * 1.12 or 1
        for name, vals, col in series:
            if not vals:
                continue
            pts = [(x0 + (x1 - x0) * i / max(1, len(vals) - 1), top + h - h * v / mx) for i, v in enumerate(vals)]
            d.line(pts, fill=col, width=3)
        d.text((x0 + 12, top + 8), label, font=F_TEXT(20), fill=(220, 224, 232))
        x = x0 + 12
        for name, vals, col in series:
            jump = max((abs(b - a) for a, b in zip(vals, vals[1:])), default=0)
            txt = f'{name}: biggest change between frames {jump:.2f}'
            d.text((x, top + h - 30), txt, font=F_MONO(17), fill=col)
            x += 560

    p = probe or {}
    turn = lambda k: [r['turn'] for r in p.get(k, [])]
    graph(130, 250, 'in-car view: how far the camera turns each frame (degrees)', [('20 Hz steps', turn('cockpitRaw'), ACCENT), ('eased', turn('cockpit'), CYAN)])
    graph(410, 230, 'chase camera: turn per frame (degrees)', [('chase', turn('chase'), YELLOW)])
    d.text((90, 660), 'The physics runs at 20 steps a second; drawn straight, the in-car view turns in jolts. Eased, it flows.', font=F_TEXT(21), fill=(190, 196, 210))
    return im


# ---- the plan ---------------------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('repo')
    ap.add_argument('--base', default='http://127.0.0.1:5308')
    ap.add_argument('--gpu', action='store_true')
    ap.add_argument('--music', help='ignored (the songs are rendered from the game)')
    a = ap.parse_args()
    repo = Path(a.repo).resolve()
    out = repo / 'test-results' / 'documentary'
    mat = out / 'material'
    cards = out / 'cards'
    cards.mkdir(parents=True, exist_ok=True)

    # ALLOW list: our own tracks only (the registry's ids), the generator's previews, our editor and game screens.
    bundled = set(re.findall(r"id: '([a-z0-9-]+)'", (repo / 'src/track/tracks/index.ts').read_text()))
    tracks_top = sorted(p for p in (mat / 'tracks').glob('track-*-top.png') if re.sub(r'^track-|-top$', '', p.stem) in bundled)
    kit = sorted((mat / 'kit').glob('*.png'))
    editor = [mat / 'editor' / f'editor-{t}.png' for t in ('lagoon-leap', 'skyline-stunts', 'harvest-havoc') if (mat / 'editor' / f'editor-{t}.png').exists()]
    flow_allow = ['flow-01-title', 'flow-02-menu', 'flow-03-car', 'flow-09-opponent', 'flow-04-track', 'flow-05-countdown', 'flow-10-race-vs', 'flow-11-results-vs', 'flow-12-replay', 'flow-08-scores']
    flow = [mat / 'flow' / f'{n}.png' for n in flow_allow if (mat / 'flow' / f'{n}.png').exists()]

    TRACK_NAMES = dict(re.findall(r"id: '([a-z0-9-]+)', name: '([^']+)'", (repo / 'src/track/tracks/index.ts').read_text()))

    def rel(p):
        return '/' + str(Path(p).resolve().relative_to(repo))

    # Generated cards.
    terminal('Unpacking: our own decompressor', [
        '$ unpack.py   (every packed data file of the game)',
        'ok   77 of 77 packed files decode to their header sizes',
        '     Huffman, most-significant bit first: loader files',
        '     Huffman, least-significant bit first: game data',
        '     run-length passes, multi-pass files',
        '',
        '$ rebuild_exe.py   (video mode: 256 colours)',
        'video-mode patch file: 5259 patches',
        'ok   image size matches its header',
        'ok   2532 relocations, all land on valid segments',
        '     entry point: the C runtime start-up',
    ]).save(cards / 'terminal.png')
    bars('Our physics vs the original code, frame by frame', [('replay 1', 2825, 2825), ('replay 2', 614, 614), ('replay 3', 2075, 2075), ('replay 4', 2656, 2656), ('replay 5', 200, 290), ('replay 6', 1290, 1290)], 'frames',
         'Car step exact on 5 of 6 recorded runs; the fifth waits for the rival AI.').save(cards / 'physics.png')
    feedback_card(feedback_rows(repo)).save(cards / 'feedback.png')
    probe_file = out / 'probe.json'
    if not probe_file.exists():
        subprocess.run(['node', 'scripts/cinema-probe.mjs', a.base, str(probe_file)] + (['--gpu'] if a.gpu else []), cwd=repo, check=True)
    qa_card(repo, json.loads(probe_file.read_text())).save(cards / 'qa.png')

    segs = []  # (clip, music) in order

    def chapter(n, title, kicker, lines, secs=4.0):
        overlays = [
            {'kind': 'banner', 'text': kicker, 'colour': 'yellow', 'y': 0.3, 'at': 0, 'dur': secs},
            {'kind': 'title', 'text': title, 'at': 0.15, 'dur': secs - 0.15, 'y': 0.52, 'size': 46, 'colour': 'white'},
        ]
        if lines:
            overlays.append({'kind': 'credits', 'y': 0.74, 'lines': [{'text': ln, 'colour': 'text', 'size': 15} for ln in lines], 'at': 0.5, 'dur': secs - 0.5})
        # The lines sit under the title.
        segs.append(({'name': f'doc-ch{n}', 'shots': [{'card': {'background': '#0b0e1c'}, 'dur': secs, 'overlays': overlays}]}, 'menu'))

    def still(name, path, secs, kicker=None, text=None, lines=None, dim=0.0):
        ov = []
        if text:
            ov.append({'kind': 'caption', 'kicker': kicker, 'text': text, 'lines': lines or [], 'at': 0, 'dur': secs})
        fit = 'cover' if Image.open(path).size == (W, H) else 'contain'
        segs.append(({'name': f'doc-{name}', 'shots': [{'card': {'image': rel(path), 'dim': dim, 'zoom': 0.06, 'fit': fit}, 'dur': secs, 'overlays': ov}]}, 'menu'))

    def play(name, moment, bars_, overlays=None, music='race'):
        segs.append(({'name': f'doc-{name}', 'moment': moment, 'dur': round(bars_ * BAR, 3), 'overlays': overlays or []}, music))

    def cap(kicker, text, secs, lines=None):
        return [{'kind': 'caption', 'kicker': kicker, 'text': text, 'lines': lines or [], 'at': 0, 'dur': secs}]

    flash = {'kind': 'flash', 'at': 0, 'dur': 0.18, 'strength': 0.6}

    # Cold open: ten seconds of the best of it, then the title.
    play('cold-1', 'loopChase', 1, [{'kind': 'fade', 'amount': 1, 'at': 0, 'dur': 0.1}])
    play('cold-2', 'bigAir', 1.5, [flash])
    play('cold-3', 'leapSplash', 1, [flash])
    play('cold-4', 'plunge', 1.5, [flash])
    play('cold-5', 'launchLow', 1, [flash])
    segs.append(({'name': 'doc-title', 'moment': 'aerialTropical', 'dur': 4.8, 'overlays': [
        {'kind': 'fade', 'amount': 0.35, 'at': 0, 'dur': 4.8},
        {'kind': 'logo', 'at': 0.1, 'dur': 4.7, 'tagline': 'THE MAKING OF', 'y': 0.42}]}, 'race'))

    # 1-2: where it started, reading the code.
    chapter(1, 'WHERE IT STARTED', 'CHAPTER 1', ['A 1990 DOS stunt racer: 176 packed files and no executable on disk.', 'A loader builds the game in memory.'])
    still('terminal', cards / 'terminal.png', 5.0)
    chapter(2, 'READING THE CODE', 'CHAPTER 2', ['79,840 instructions in 42 segments, 548 functions.', 'Behaviour written up in our own words, then rebuilt.'])
    # 3: ground truth → a car hitting a loop.
    chapter(3, 'GROUND TRUTH', 'CHAPTER 3', ["The original code, run in a CPU emulator, plays its own recorded runs.", 'Every frame of car state becomes a test for our physics.'])
    still('physics', cards / 'physics.png', 5.0)
    play('physics-loop1', 'loopChase', 1.5, cap('THE PAYOFF', 'Real physics: the loop', 2.4, ['speed, grip and gravity, 20 steps a second']))
    play('physics-loop2', 'loopCockpit', 1.5, [flash])
    play('physics-loop3', 'harvestLoopChase', 1, [])
    # 4: the track kit → driving the pieces.
    chapter(4, 'A TRACK KIT', 'CHAPTER 4', ['No asset pack has loops, corkscrews or pipes.', 'So the generator learned to sweep road profiles along 3D paths.'])
    for i, p in enumerate(kit):
        still(f'kit-{p.stem}', p, 1.4, 'GENERATOR PIECE', p.stem.replace('-', ' ').upper()) if i % 3 == 0 else still(f'kit-{p.stem}', p, 1.4)
    still('feedback', cards / 'feedback.png', 5.0)
    play('kit-pipe', 'skyPipeChase', 1, cap('DRIVING THE PIECES', 'Pipe', 1.6))
    play('kit-banked', 'palmBanked', 1, cap('DRIVING THE PIECES', 'Banked hairpin', 1.6))
    play('kit-helix', 'helixChase', 1, cap('DRIVING THE PIECES', 'Helix', 1.6))
    play('kit-flyover', 'flyoverJump', 1.5, cap('DRIVING THE PIECES', 'Ramp over the road', 2.4))
    # 5: ten tracks → a lap of each set.
    chapter(5, 'TEN TRACKS', 'CHAPTER 5', ['Designed for this game across five scenery sets.'])
    for p in tracks_top:
        still(f'top-{p.stem}', p, 1.0, 'FROM ABOVE', TRACK_NAMES.get(re.sub(r'^track-|-top$', '', p.stem), ''))
    for name, moment, ride, label in [('tropical', 'aerialTropical', 'palmHighway', 'Tropical: Palm Bay'), ('desert', 'aerialDesert', 'cactusJump', 'Desert: Cactus Canyon'),
                                      ('city', 'aerialCity', 'downtownDuel', 'City: Downtown Rush'), ('alpine', 'aerialAlpine', 'helixFront', 'Alpine: Glacier Pass'),
                                      ('country', 'aerialCountry', 'sundayDuel', 'Country: Sunday Drive')]:
        play(f'set-{name}-a', moment, 1.5, cap('SCENERY SET', label, 2.4))
        play(f'set-{name}-b', ride, 1, [flash])
    # 6: the editor → test drive.
    chapter(6, 'THE TRACK EDITOR', 'CHAPTER 6', ['A 30 by 30 grid, terrain, live 3D preview and circuit checks.'])
    for i, p in enumerate(editor):
        still(f'editor-{i}', p, 2.0, 'TRACK EDITOR', ['Lagoon Leap', 'Skyline Stunts', 'Harvest Havoc'][i] if i < 3 else '')
    play('editor-drive', 'harvestLoopCockpit', 1, cap('TEST DRIVE', 'Straight from the editor', 1.6))
    play('editor-drive2', 'harvestJump', 1.5, [flash])
    # 7: the game → racing the rivals.
    chapter(7, 'THE GAME', 'CHAPTER 7', ['Eight cars, six rivals, races, replays and high scores.'])
    for p in flow:
        still(f'flow-{p.stem}', p, 1.2)
    play('game-duel1', 'sundaySide', 1, cap('RIVALS', 'Nova Kade, wheel to wheel', 1.6))
    play('game-duel2', 'helixChase', 1, [flash])
    play('game-duel3', 'downtownDuel', 1, [])
    # 8: polish, in anticipation of Tony's review.
    chapter(8, 'BEFORE TONY PLAYS IT', 'CHAPTER 8', ['Getting ready for Tony\'s review:', 'hunting every jitter, pop and flicker.'])
    still('qa', cards / 'qa.png', 7.0)
    play('qa-smooth', 'loopCockpit', 2, cap('EASED', 'The in-car view through the loop', 3.2))
    # Final montage.
    for i, (m, b) in enumerate([('launchCockpit', 1), ('avaLoopCockpit', 1), ('lagoonLeap2', 1), ('canalJump', 1), ('rollChase', 1), ('tarnJump', 2), ('palmCauseway', 1), ('cactusJump2', 1), ('harvestRiver', 2), ('plunge', 2), ('harvestBig', 2)]):
        play(f'montage-{i}-{m}', m, b, [flash] if i else [])
    segs.append(({'name': 'doc-credits', 'moment': 'aerialAlpine', 'dur': 8.0, 'overlays': [
        {'kind': 'fade', 'amount': 0.6, 'at': 0, 'dur': 8},
        {'kind': 'credits', 'at': 0.2, 'dur': 7.6, 'lines': [
            {'text': 'CAR SMASH STUNT TRACKS', 'colour': 'yellow', 'size': 26},
            {'text': 'Models: Synty assets through the Synty Sprite Generator', 'colour': 'text', 'size': 12},
            {'text': 'Code, tracks, physics, music and sound: our own', 'colour': 'text', 'size': 12},
            {'text': 'All gameplay recorded frame by frame on our own tracks', 'colour': 'cyan', 'size': 12}]},
        {'kind': 'fade', 'amount': 1, 'at': 7.6, 'dur': 0.4}]}, 'menu'))

    # Record every clip (cached), then cut.
    clips = [c for c, _ in segs]
    plan = out / 'plan.json'
    plan.write_text(json.dumps(clips, indent=1))
    subprocess.run(['node', 'scripts/record.mjs', str(plan), '--base', a.base] + (['--gpu'] if a.gpu else []), cwd=repo, check=True)
    files = [repo / 'test-results' / 'video' / 'clips' / f"{c['name']}.mp4" for c in clips]
    durs = [float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(f)], capture_output=True, text=True).stdout) for f in files]
    total = sum(durs)
    songs = {}
    for song in ('menu', 'race'):
        wav = repo / 'test-results' / 'video' / f'music-{song}-{int(total) + 8}.wav'
        if not wav.exists():
            subprocess.run(['node', 'scripts/render-music.mjs', a.base, song, str(int(total) + 8), str(wav)], cwd=repo, check=True)
        songs[song] = wav

    # Audio: each segment's own sound (gameplay: engines and crashes), plus its song from where that song left off,
    # with short fades at the switches.
    inputs = []
    for f in files:
        inputs += ['-i', str(f)]
    nm = len(files)
    inputs += ['-i', str(songs['menu']), '-i', str(songs['race'])]
    parts = [''.join(f'[{i}:v]' for i in range(nm)) + f'concat=n={nm}:v=1:a=0,fps=60[v]']
    mixes = []
    pos = {'menu': 0.05, 'race': 0.05}
    t = 0.0
    k = 0
    i = 0
    # Merge runs of the same song so the music only fades at a switch.
    while i < nm:
        song = segs[i][1]
        j = i
        run = 0.0
        while j < nm and segs[j][1] == song:
            run += durs[j]
            j += 1
        src = nm if song == 'menu' else nm + 1
        level = 0.55 if song == 'menu' else 0.8
        parts.append(f'[{src}:a]atrim=start={pos[song]:.3f}:duration={run:.3f},asetpts=PTS-STARTPTS,afade=t=in:d=0.25,afade=t=out:st={max(0, run - 0.3):.3f}:d=0.3,volume={level},adelay={int(t * 1000)}|{int(t * 1000)}[m{k}]')
        mixes.append(f'[m{k}]')
        pos[song] += run
        t += run
        k += 1
        i = j
    t = 0.0
    for idx in range(nm):
        if segs[idx][1] == 'race' or segs[idx][0].get('moment'):
            parts.append(f'[{idx}:a]volume=0.6,adelay={int(t * 1000)}|{int(t * 1000)}[s{idx}]')
            mixes.append(f'[s{idx}]')
        t += durs[idx]
    parts.append(''.join(mixes) + f'amix=inputs={len(mixes)}:normalize=0:duration=longest,atrim=duration={total:.3f},alimiter=limit=0.95[a]')
    final = out / 'documentary.mp4'
    script = out / 'filter.txt'
    script.write_text(';\n'.join(parts))
    subprocess.run(['ffmpeg', '-y', '-v', 'error', *inputs, '-filter_complex_script', str(script), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19',
                    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', str(final)], cwd=repo, check=True)
    print(json.dumps({'out': str(final), 'seconds': round(total, 1), 'segments': nm, 'tracks': len(tracks_top), 'kit': len(kit), 'editor': len(editor), 'flow': len(flow)}))


if __name__ == '__main__':
    main()
