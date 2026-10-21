// Instrument patches for the songs: 2-operator FM, voiced like a late-80s FM synth / sound card bank.
import type { Patch } from '../fm';

/** Synth brass stab/lead: the index swells in with each note. */
export const brass: Patch = { car: 'sawtooth', mod: 'sine', ratio: 1, index: 1.4, indexAttack: 0.06, indexEnd: 0.7, indexTime: 0.3, a: 0.02, d: 0.25, s: 0.75, r: 0.12, gain: 0.07, lp: 3200, vib: [5.5, 12] };
/** Square lead with a touch of FM edge. */
export const lead: Patch = { car: 'square', mod: 'sine', ratio: 2, index: 0.5, indexEnd: 0.2, indexTime: 0.2, a: 0.005, d: 0.2, s: 0.7, r: 0.1, gain: 0.07, lp: 3600, vib: [6, 16] };
/** Bright bell-ish lead: 3.5:1, index settling. */
export const bellLead: Patch = { car: 'sine', mod: 'sine', ratio: 3.5, index: 2.2, indexEnd: 0.25, indexTime: 0.3, a: 0.003, d: 0.5, s: 0.35, r: 0.2, gain: 0.12, vib: [5, 10] };
/** Punchy FM bass: 1:1, bright attack snapping shut. */
export const bass: Patch = { car: 'sine', mod: 'sine', ratio: 1, index: 3, indexEnd: 0.25, indexTime: 0.08, a: 0.002, d: 0.22, s: 0.5, r: 0.05, gain: 0.3, gate: 0.8 };
/** Short pluck for arpeggios. */
export const arp: Patch = { car: 'sine', mod: 'sine', ratio: 2, index: 2.4, indexEnd: 0.1, indexTime: 0.1, a: 0.002, d: 0.18, s: 0, r: 0.06, gain: 0.07 };
/** String-machine pad: filtered saw, slow attack. */
export const pad: Patch = { car: 'sawtooth', mod: 'sine', ratio: 1, index: 0.2, a: 0.25, d: 0.6, s: 0.8, r: 0.5, gain: 0.025, lp: 1500, vib: [4.5, 8] };
/** Electric piano: 1:1 with a quick bright tine. */
export const epiano: Patch = { car: 'sine', mod: 'sine', ratio: 1, index: 1.6, indexEnd: 0.25, indexTime: 0.35, a: 0.003, d: 0.8, s: 0.25, r: 0.25, gain: 0.07 };
/** Soft round lead for the editor tune. */
export const flute: Patch = { car: 'sine', mod: 'sine', ratio: 1, index: 0.6, indexAttack: 0.04, a: 0.04, d: 0.2, s: 0.8, r: 0.15, gain: 0.1, vib: [5, 14] };
