// A short message at the top of the screen (settings changes, "replay saved"), gone after a moment.
import { addStyle, PIXEL_FONT } from './pixel';

const CSS = `
.cs-toast { position: fixed; top: 18px; left: 50%; transform: translateX(-50%) skewX(-12deg); z-index: 50; pointer-events: none;
  font-family: ${PIXEL_FONT}; font-size: 11px; color: #0b0e1c; background: #35d6ff; padding: 12px 20px; box-shadow: 5px 5px 0 rgba(0,0,0,.45); }
`;

let el: HTMLDivElement | null = null;
let timer = 0;

export function toast(text: string, seconds = 1.6) {
  addStyle('cs-toast-css', CSS);
  el ??= document.createElement('div');
  el.className = 'cs-toast';
  el.textContent = text;
  document.body.appendChild(el);
  clearTimeout(timer);
  timer = window.setTimeout(() => el?.remove(), seconds * 1000);
}
