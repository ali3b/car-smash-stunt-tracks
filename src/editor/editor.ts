// The track editor (?scene=editor): a top-down grid (gridview.ts) with a palette of pieces and terrain tools, a live
// 3D preview (preview3d.ts), validation of the circuit (validate.ts), save / load / export / import (storage.ts)
// and a "Test drive" button that hands the track to the race scene (localStorage cs.customTrack,
// ?scene=race&track=custom). window.__cs.editor is the handle scripts/editor-check.mjs drives.
import '@fontsource/press-start-2p/400.css';
import './editor.css';
import type { Piece, Rot, Scenery, Surface, TrackFile } from '../track/types';
import { EditorDoc, emptyTrack } from './doc';
import { drawIcon } from './draw';
import { GridView, type Tool } from './gridview';
import { PALETTE, entryFor, type PaletteEntry } from './palette';
import { Preview3D } from './preview3d';
import { getAudio } from '../audio';
import * as store from './storage';
import { validateTrack, type Report } from '../track/validate';

const TOOLS: { id: Tool; label: string; key: string; title: string; icon: string }[] = [
  { id: 'select', label: 'Select', key: '1', title: 'Select, drag to move (Del deletes, R rotates)', icon: '<path d="M5 3l12 8-5 1 3 6-2 1-3-6-4 3z"/>' },
  { id: 'place', label: 'Place', key: '2', title: 'Place the brush piece (drag to paint 1×1 pieces, Shift replaces)', icon: '<path d="M4 16h12M10 4v9M6 9l4 4 4-4"/>' },
  { id: 'erase', label: 'Erase', key: '3', title: 'Erase pieces (right-click erases with any tool)', icon: '<path d="M4 14l7-8 6 5-6 6H7zM9 17h8"/>' },
  { id: 'hill', label: 'Hill', key: '4', title: 'Raise a tile to the hill top', icon: '<path d="M2 16l5-7h6l5 7z"/>' },
  { id: 'dig', label: 'Level', key: '5', title: 'Lower a tile to the ground', icon: '<path d="M2 8h16M4 12l3 4h6l3-4"/>' },
  { id: 'corner-up', label: 'Corner+', key: '6', title: 'Raise the nearest grid corner (make slopes)', icon: '<path d="M3 16L17 6v10z"/><circle cx="17" cy="6" r="2"/>' },
  { id: 'corner-down', label: 'Corner−', key: '7', title: 'Lower the nearest grid corner', icon: '<path d="M3 6l14 10H3z"/><circle cx="17" cy="16" r="2"/>' },
  { id: 'water', label: 'Water', key: '8', title: 'Flood a tile', icon: '<path d="M2 8q4-3 8 0t8 0M2 13q4-3 8 0t8 0"/>' },
  { id: 'coast', label: 'Coast', key: '9', title: 'Half-flood a tile (the half under the cursor)', icon: '<path d="M3 3h14v14z"/><path d="M3 3l14 14"/>' },
  { id: 'dry', label: 'Dry', key: '0', title: 'Drain a tile', icon: '<path d="M10 3c3 4 5 7 5 9a5 5 0 01-10 0c0-2 2-5 5-9zM3 17L17 3"/>' },
];

const SCENERIES: Scenery[] = ['country', 'desert', 'tropical', 'alpine', 'city'];
const SURFACES: Surface[] = ['paved', 'dirt', 'ice'];

const h = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (html) el.innerHTML = html;
  return el;
};

function initialTrack(): TrackFile {
  const work = store.loadWork();
  if (work) return work;
  const bundled = Object.values(store.bundledTracks());
  return bundled[0] ? JSON.parse(JSON.stringify(bundled[0])) : emptyTrack();
}

export async function startEditor() {
  document.body.classList.add('editor');
  document.title = 'Track editor · Car Smash Stunt Tracks';
  // The editor's music (starts on the first click or key: the browser's autoplay rule).
  getAudio().emit('scene', { name: 'editor' });
  window.__cs.audio = getAudio();
  const doc = new EditorDoc(initialTrack());

  // ---- state ----
  let tool: Tool = 'place';
  let entry: PaletteEntry = PALETTE[0].entries[0];
  const variantFor = new Map<PaletteEntry, string>();
  let surface: Surface = 'paved';
  let rot: Rot = 0;
  let selected = -1;
  let report: Report = validateTrack(doc.track);

  const brushVariant = () => entry.variant ?? (entry.variants ? (variantFor.get(entry) ?? entry.variants[0][0]) : undefined);
  const brush = (): Piece | null => ({ x: 0, z: 0, kind: entry.kind, rot, ...(brushVariant() ? { variant: brushVariant() } : {}), ...(entry.surfaces && surface !== 'paved' ? { surface } : {}) });

  // ---- layout ----
  const root = h('div', { class: 'ed' });
  root.innerHTML = `
    <header class="ed-top">
      <a class="ed-brand" href="./" title="Back to the game" style="color:inherit;text-decoration:none">CAR SMASH<small>TRACK EDITOR</small></a>
      <label class="ed-field">Name <input type="text" id="ed-name" maxlength="40" spellcheck="false"></label>
      <label class="ed-field">Scenery <select id="ed-scenery">${SCENERIES.map((s) => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select></label>
      <div class="ed-sep"></div>
      <button id="ed-new" title="Start an empty track">New</button>
      <select id="ed-open" title="Open a saved, bundled or reference track"><option value="">Open…</option></select>
      <button id="ed-save" title="Save in this browser (Ctrl+S)">Save</button>
      <button id="ed-export" title="Download as a JSON file">Export</button>
      <button id="ed-import" title="Load a JSON track file">Import</button>
      <input type="file" id="ed-file" accept=".json,application/json" hidden>
      <div class="ed-sep"></div>
      <button id="ed-undo" title="Undo (Ctrl+Z)">↶ Undo</button>
      <button id="ed-redo" title="Redo (Ctrl+Y)">↷ Redo</button>
      <div class="grow"></div>
      <button id="ed-drive" class="primary" title="Race this track">▶ TEST DRIVE</button>
    </header>
    <aside class="ed-left">
      <h3>Tools</h3>
      <div class="ed-tools" id="ed-tools"></div>
      <h3>Brush</h3>
      <div class="ed-brush">
        <div class="ed-brush-row"><span>Piece</span><span class="ed-brush-name" id="ed-brush-name"></span></div>
        <div class="ed-brush-row"><span>Rotate</span><div class="ed-seg"><button id="ed-rot-l" title="Rotate anticlockwise (Shift+R)">⟲</button><button id="ed-rot" disabled></button><button id="ed-rot-r" title="Rotate clockwise (R)">⟳</button></div></div>
        <div class="ed-brush-row" id="ed-variant-row"><span>Variant</span><div class="ed-seg" id="ed-variants"></div></div>
        <div class="ed-brush-row" id="ed-surface-row"><span>Surface</span><div class="ed-seg" id="ed-surfaces">${SURFACES.map((s) => `<button data-surface="${s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div></div>
      </div>
      <h3>Pieces</h3>
      <div class="ed-palette" id="ed-palette"></div>
    </aside>
    <main class="ed-centre">
      <div class="ed-grid" id="ed-grid"></div>
      <div class="ed-status"><span class="coords" id="ed-coords">–</span><span class="msg" id="ed-msg">Pick a piece, click the grid to place it. R rotates, right-click erases.</span><span id="ed-count"></span></div>
    </main>
    <aside class="ed-right">
      <h3>3D preview</h3>
      <div class="ed-preview" id="ed-preview"><span class="ed-preview-note" id="ed-preview-note"></span><div class="ed-preview-bar"><button id="ed-overview" title="Whole track">Overview</button><button id="ed-focus" title="Look at the selection">Focus</button></div></div>
      <h3>Circuit</h3>
      <div class="ed-report">
        <div class="ed-verdict" id="ed-verdict"></div>
        <div class="ed-stats" id="ed-stats"></div>
        <ul class="ed-issues" id="ed-issues"></ul>
        <dl class="ed-keys">
          <dt><kbd>R</kbd> <kbd>⇧R</kbd></dt><dd>rotate</dd><dt><kbd>V</kbd> / <kbd>S</kbd></dt><dd>variant / surface</dd>
          <dt><kbd>Del</kbd></dt><dd>delete selected</dd><dt><kbd>←↑→↓</kbd></dt><dd>move selected</dd>
          <dt><kbd>⇧</kbd>+click</dt><dd>replace</dd><dt><kbd>Alt</kbd>+click</dt><dd>pick into brush</dd>
          <dt>right-click</dt><dd>erase</dd><dt><kbd>Ctrl</kbd> <kbd>Z</kbd>/<kbd>Y</kbd></dt><dd>undo / redo</dd>
          <dt>wheel</dt><dd>zoom grid</dd><dt><kbd>Space</kbd>+drag</dt><dd>pan · <kbd>Home</kbd> fit</dd>
        </dl>
      </div>
    </aside>`;
  document.body.appendChild(root);
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector<T>(`#${id}`)!;

  // ---- status ----
  const msg = $('ed-msg');
  const status = (text: string, tone: 'info' | 'error' | 'ok' = 'info') => {
    msg.textContent = text;
    msg.className = `msg ${tone}`;
  };

  // ---- tools ----
  const toolsEl = $('ed-tools');
  for (const t of TOOLS) {
    const b = h('button', { class: 'ed-tool', 'data-tool': t.id, title: `${t.title} [${t.key}]` }, `<kbd>${t.key}</kbd><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round">${t.icon}</svg>${t.label}`);
    b.onclick = () => setTool(t.id);
    toolsEl.appendChild(b);
  }
  function setTool(t: Tool) {
    tool = t;
    for (const b of toolsEl.querySelectorAll<HTMLElement>('.ed-tool')) b.classList.toggle('on', b.dataset.tool === t);
    grid.redraw();
  }

  // ---- palette ----
  const paletteEl = $('ed-palette');
  const items = new Map<PaletteEntry, HTMLButtonElement>();
  for (const g of PALETTE) {
    const group = h('div', { class: 'ed-group' }, `<h4>${g.name}</h4>`);
    const list = h('div', { class: 'ed-group-items' });
    for (const e of g.entries) {
      const b = h('button', { class: 'ed-item', title: e.label, 'data-kind': e.kind, ...(e.variant ? { 'data-variant': e.variant } : {}) });
      const c = h('canvas', { width: '88', height: '88' });
      b.append(c, document.createTextNode(e.label));
      b.onclick = () => {
        entry = e;
        setTool('place');
        refreshBrush();
      };
      items.set(e, b);
      list.appendChild(b);
    }
    group.appendChild(list);
    paletteEl.appendChild(group);
  }
  const drawIcons = () => {
    for (const [e, b] of items) drawIcon(b.querySelector('canvas')!, { x: 0, z: 0, kind: e.kind, rot: 0, ...(e.variant || e.variants ? { variant: e.variant ?? variantFor.get(e) ?? e.variants![0][0] } : {}) }, doc.track.scenery);
  };

  const variantsEl = $('ed-variants');
  function refreshBrush() {
    for (const [e, b] of items) b.classList.toggle('on', e === entry);
    $('ed-brush-name').textContent = entry.label;
    $('ed-rot').innerHTML = `<span class="ed-rot" style="display:inline-block;transform:rotate(${rot * 90}deg)">↑</span> ${rot * 90}°`;
    $('ed-variant-row').style.display = entry.variants ? '' : 'none';
    variantsEl.innerHTML = '';
    for (const [v, label] of entry.variants ?? []) {
      const b = h('button', { 'data-variant': v }, label);
      b.classList.toggle('on', v === brushVariant());
      b.onclick = () => {
        variantFor.set(entry, v);
        refreshBrush();
        drawIcons();
      };
      variantsEl.appendChild(b);
    }
    $('ed-surface-row').style.opacity = entry.surfaces ? '1' : '0.35';
    for (const b of $('ed-surfaces').querySelectorAll<HTMLButtonElement>('button')) {
      b.classList.toggle('on', b.dataset.surface === surface);
      b.disabled = !entry.surfaces;
    }
    grid.redraw();
  }
  for (const b of $('ed-surfaces').querySelectorAll<HTMLButtonElement>('button'))
    b.onclick = () => {
      surface = b.dataset.surface as Surface;
      const p = doc.track.pieces[selected];
      if (p && entryFor(p.kind, p.variant)?.surfaces) doc.update(selected, { surface });
      refreshBrush();
    };
  const rotate = (dir: 1 | -1) => {
    if (selected >= 0) {
      const r = doc.rotate(selected, dir);
      if (!r.ok) status(`Can’t rotate: ${r.reason}.`, 'error');
      return;
    }
    rot = ((rot + dir + 4) % 4) as Rot;
    refreshBrush();
  };
  $('ed-rot-l').onclick = () => rotate(-1);
  $('ed-rot-r').onclick = () => rotate(1);

  // ---- grid ----
  const host = {
    doc,
    get tool() {
      return tool;
    },
    brush,
    get selected() {
      return selected;
    },
    get report() {
      return report;
    },
    select(i: number) {
      selected = i;
      const p = doc.track.pieces[i];
      preview.setHighlight(p ?? null);
      if (p) status(`Selected the ${p.kind}${p.variant ? ` (${p.variant})` : ''} at ${p.x},${p.z}, rotation ${p.rot * 90}°.`);
      grid.redraw();
    },
    status,
    pick(p: Piece) {
      const e = entryFor(p.kind, p.variant);
      if (!e) return;
      entry = e;
      rot = p.rot;
      if (e.variants && p.variant) variantFor.set(e, p.variant);
      if (p.surface) surface = p.surface;
      setTool('place');
      refreshBrush();
      status(`Brush: ${e.label}.`);
    },
  };
  const grid = new GridView($('ed-grid'), host);
  const coords = $('ed-coords');
  grid.onHover = (hv) => {
    if (!hv) {
      coords.textContent = '–';
      return;
    }
    coords.textContent = tool === 'corner-up' || tool === 'corner-down' ? `◇ ${hv.cx},${hv.cz}` : `${hv.x},${hv.z}`;
  };

  // ---- 3D preview ----
  const preview = new Preview3D($('ed-preview'));
  const note = $('ed-preview-note');
  note.textContent = 'loading models…';
  preview.loadModels().then((n) => {
    note.textContent = n ? '' : 'placeholder pieces (no models built)';
    window.__cs.models = n;
  });
  $('ed-overview').onclick = () => preview.overview(doc.track);
  $('ed-focus').onclick = () => {
    const p = doc.track.pieces[selected];
    if (p) preview.focus(p.x, p.z);
  };

  // ---- report ----
  const verdict = $('ed-verdict');
  const statsEl = $('ed-stats');
  const issuesEl = $('ed-issues');
  function renderReport() {
    const c = report.circuit;
    const errors = report.issues.filter((i) => i.severity === 'error').length;
    const ok = c.status === 'closed' && errors === 0;
    verdict.className = `ed-verdict ${ok ? 'ok' : 'bad'}`;
    const title = c.status === 'closed' ? (errors ? 'CIRCUIT CLOSED, BUT…' : 'CIRCUIT CLOSED') : c.status === 'no-start' ? 'NO START LINE' : 'CIRCUIT OPEN';
    verdict.innerHTML = `<span class="icon">${ok ? '✔' : '✖'}</span><div>${title}<small>${ok ? 'Ready to race.' : c.status === 'closed' ? `${errors} error${errors > 1 ? 's' : ''} to fix.` : c.message[0].toUpperCase() + c.message.slice(1) + '.'}</small></div>`;
    verdict.dataset.status = c.status;
    const roads = doc.track.pieces.filter((p) => p.kind !== 'scenery').length;
    const stunts = c.route.filter((s) => ['loop', 'corkscrew-roll', 'corkscrew-helix', 'pipe', 'chicane', 'slalom'].includes(doc.track.pieces[s.piece].kind)).length;
    const stat = (n: number | string, label: string) => `<div class="ed-stat"><b>${n}</b><span>${label}</span></div>`;
    statsEl.innerHTML = stat(c.route.length, 'on circuit') + stat(c.jumps.length, 'jumps') + stat(stunts, 'stunts') + stat(roads, 'road pieces');
    issuesEl.innerHTML = '';
    if (!report.issues.length) issuesEl.appendChild(h('li', { class: 'none' }, 'No issues.'));
    for (const i of report.issues) {
      const li = h('li', { class: i.severity }, `<b>${i.severity === 'error' ? 'ERR' : 'WARN'}</b><span></span>`);
      li.querySelector('span')!.textContent = i.message;
      li.onclick = () => {
        if (i.piece !== undefined && doc.track.pieces[i.piece]) host.select(i.piece);
        if (i.at) preview.focus(i.at.x, i.at.z);
      };
      issuesEl.appendChild(li);
    }
    $('ed-count').textContent = `${doc.track.pieces.length} pieces`;
  }

  // ---- track meta and files ----
  const nameEl = $<HTMLInputElement>('ed-name');
  const sceneryEl = $<HTMLSelectElement>('ed-scenery');
  nameEl.onchange = () => doc.setMeta({ name: nameEl.value.trim() || 'untitled' });
  sceneryEl.onchange = () => doc.setMeta({ scenery: sceneryEl.value as Scenery });
  const openEl = $<HTMLSelectElement>('ed-open');
  async function fillOpen() {
    const group = (label: string, values: [string, string][]) => (values.length ? `<optgroup label="${label}">${values.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</optgroup>` : '');
    const saved = Object.keys(store.savedTracks()).sort();
    const bundled = Object.keys(store.bundledTracks()).sort();
    const local = await store.localTrackNames();
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    openEl.innerHTML =
      '<option value="">Open…</option>' +
      group('Saved in this browser', saved.map((n) => [`saved:${esc(n)}`, esc(n)])) +
      group('Bundled tracks', bundled.map((n) => [`bundled:${esc(n)}`, esc(n)])) +
      group('Reference tracks (dev only)', local.map((n) => [`local:${esc(n)}`, esc(n)]));
  }
  openEl.onchange = async () => {
    const v = openEl.value;
    openEl.value = '';
    const [src, name] = [v.slice(0, v.indexOf(':')), v.slice(v.indexOf(':') + 1)];
    try {
      let t: TrackFile | undefined;
      if (src === 'saved') t = store.savedTracks()[name];
      else if (src === 'bundled') t = store.bundledTracks()[name];
      else if (src === 'local') t = await store.loadLocalTrack(name);
      if (!t) return;
      openTrack(t, `Opened “${t.name}”.`);
    } catch (e) {
      status(`Couldn’t open: ${(e as Error).message}.`, 'error');
    }
  };
  function openTrack(t: TrackFile, text: string) {
    host.select(-1);
    doc.load(JSON.parse(JSON.stringify(t)));
    preview.overview(doc.track);
    status(text, 'ok');
  }
  $('ed-new').onclick = () => openTrack(emptyTrack('new track', doc.track.scenery), 'New track. Undo brings the old one back.');
  const save = () => {
    if (store.saveTrack(doc.track)) {
      status(`Saved “${doc.track.name}” in this browser.`, 'ok');
      fillOpen();
    } else status('Couldn’t save: browser storage is unavailable or full.', 'error');
  };
  $('ed-save').onclick = save;
  $('ed-export').onclick = () => {
    store.exportFile(doc.track);
    status(`Exported “${doc.track.name}”.`, 'ok');
  };
  const fileEl = $<HTMLInputElement>('ed-file');
  $('ed-import').onclick = () => fileEl.click();
  fileEl.onchange = async () => {
    const f = fileEl.files?.[0];
    fileEl.value = '';
    if (!f) return;
    try {
      openTrack(await store.importFile(f), `Imported “${f.name}”.`);
    } catch (e) {
      status(`Couldn’t import ${f.name}: ${(e as Error).message}.`, 'error');
    }
  };
  $('ed-undo').onclick = () => doc.undo();
  $('ed-redo').onclick = () => doc.redo();
  const testDrive = () => {
    if (report.circuit.status !== 'closed' && !confirm(`This track isn’t a closed circuit (${report.circuit.message}). Drive it anyway?`)) return;
    if (!store.setCustomTrack(doc.track)) {
      status('Couldn’t hand the track over: browser storage is unavailable.', 'error');
      return;
    }
    location.href = `${location.pathname}?scene=race&track=custom`;
  };
  $('ed-drive').onclick = testDrive;

  // ---- keyboard ----
  addEventListener('keydown', (e) => {
    const k = e.key;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && k === 's') {
      // Works from the name field too: commit the name first.
      if (document.activeElement === nameEl) nameEl.dispatchEvent(new Event('change'));
      save();
      e.preventDefault();
      return;
    }
    if ((e.target as HTMLElement).closest('input, select, textarea')) return;
    if (ctrl && (k === 'z' || k === 'Z')) {
      e.shiftKey ? doc.redo() : doc.undo();
      e.preventDefault();
    } else if (ctrl && k === 'y') {
      doc.redo();
      e.preventDefault();
    } else if (ctrl) return;
    else if (k === 'r' || k === 'R') rotate(e.shiftKey ? -1 : 1);
    else if (k === 'v' || k === 'V') {
      if (!entry.variants) return;
      const vs = entry.variants.map((v) => v[0]);
      variantFor.set(entry, vs[(vs.indexOf(brushVariant()!) + 1) % vs.length]);
      refreshBrush();
      drawIcons();
    } else if (k === 's' || k === 'S') {
      surface = SURFACES[(SURFACES.indexOf(surface) + 1) % SURFACES.length];
      const p = doc.track.pieces[selected];
      if (p && entryFor(p.kind, p.variant)?.surfaces) doc.update(selected, { surface });
      refreshBrush();
      status(`Surface: ${surface}.`);
    } else if ((k === 'Delete' || k === 'Backspace') && selected >= 0) {
      doc.remove(selected);
      host.select(-1);
    } else if (k.startsWith('Arrow') && selected >= 0) {
      const p = doc.track.pieces[selected];
      const [dx, dz] = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[k] ?? [0, 0];
      const r = doc.update(selected, { x: p.x + dx, z: p.z + dz });
      if (!r.ok) status(`Can’t move there: ${r.reason}.`, 'error');
      e.preventDefault();
    } else if (k === ' ') {
      grid.spaceHeld = true;
      e.preventDefault();
    } else if (k === 'Home') grid.fit();
    else if (k === 'Escape') {
      host.select(-1);
      setTool('select');
    } else {
      const t = TOOLS.find((t) => t.key === k);
      if (t) setTool(t.id);
    }
    if (k === 'Shift') {
      grid.shiftHeld = true;
      grid.redraw();
    }
  });
  addEventListener('keyup', (e) => {
    if (e.key === 'Shift') {
      grid.shiftHeld = false;
      grid.redraw();
    }
    if (e.key === ' ') grid.spaceHeld = false;
  });

  // ---- changes ----
  let lastScenery = '';
  const onChange = () => {
    if (selected >= doc.track.pieces.length) selected = -1;
    report = validateTrack(doc.track);
    nameEl.value = doc.track.name;
    sceneryEl.value = doc.track.scenery;
    if (doc.track.scenery !== lastScenery) {
      lastScenery = doc.track.scenery;
      drawIcons();
    }
    ($('ed-undo') as HTMLButtonElement).disabled = !doc.canUndo;
    ($('ed-redo') as HTMLButtonElement).disabled = !doc.canRedo;
    renderReport();
    grid.redraw();
    preview.update(doc.track);
    preview.setHighlight(doc.track.pieces[selected] ?? null);
    store.saveWork(doc.track);
  };
  doc.onChange(onChange);
  onChange();
  preview.overview(doc.track);
  setTool(tool);
  refreshBrush();
  fillOpen();

  // ---- test handle ----
  window.__cs.editor = {
    doc,
    report: () => report,
    preview: () => preview.stats,
    /** Page coordinates of a tile's centre on the grid canvas. */
    tileToClient(x: number, z: number) {
      const r = grid.canvas.getBoundingClientRect();
      const [cx, cy] = grid.tileCentre(x, z);
      return { x: r.left + cx, y: r.top + cy };
    },
    selectEntry(kind: string, variant?: string) {
      const e = [...items.keys()].find((e) => e.kind === kind && (!variant || e.variant === variant || e.variants?.some((v) => v[0] === variant)));
      if (!e) return false;
      items.get(e)!.click();
      if (variant && e.variants) {
        variantFor.set(e, variant);
        refreshBrush();
      }
      return true;
    },
  };
  window.__cs.ready = true;
}
