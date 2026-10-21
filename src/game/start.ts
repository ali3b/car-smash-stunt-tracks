// Boots the game (?scene=game, the default): renderer, keyboard, the flow; window.__cs.flow is the test handle.
import { createStage } from '../engine/renderer';
import { initKeyboard } from '../engine/input';
import { Flow } from './flow';
import { registerSimSession } from './sim-session';
import { TouchControls } from '../ui/touch-controls';
import { getAudio } from '../audio';

/** `race`: a track id to race straight away (?scene=race&track=...), skipping the title and menus. */
export async function startGame(opts: { race?: string } = {}) {
  registerSimSession();
  const stage = createStage(document.body);
  initKeyboard();
  const flow = new Flow(stage.renderer);
  window.__cs.flow = flow.handle();
  window.__cs.renderer = stage.renderer;
  // On-screen driving controls on touch screens (phones, tablets, touch laptops).
  if (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) {
    const touch = new TouchControls({ racing: () => flow.racing(), manual: () => flow.manualGearbox() });
    window.__cs.touch = touch.handle();
  }
  window.__cs.loop = flow.loop;
  // The sound system (checks read its levels: scripts/race-audio-check.mjs).
  window.__cs.audio = getAudio();
  await flow.start();
  if (opts.race) await flow.handle().go.race({ trackId: opts.race });
  window.__cs.ready = true;
}
