// The pixel font (Press Start 2P, OFL, bundled) and a once-only stylesheet helper.
import '@fontsource/press-start-2p/400.css';

export const PIXEL_FONT = `'Press Start 2P', ui-monospace, monospace`;

/** Add a stylesheet once. */
export function addStyle(id: string, css: string) {
  if (document.getElementById(id)) return;
  const s = document.createElement('style');
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** m:ss.cc */
export function fmtTime(s: number | null | undefined): string {
  if (s === null || s === undefined || !isFinite(s)) return '-:--.--';
  const cs = Math.round(s * 100);
  const m = Math.floor(cs / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  return `${m}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
}
