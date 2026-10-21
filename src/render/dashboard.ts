// The in-car dashboard: our own drawing (CS-FB-005: no Synty dashboard / instrument-cluster part), a canvas over the
// bottom of the view with the dash panel, a speedometer (mph) and a rev counter with a red line.
export class Dashboard {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private shown = false;
  private speed = 0;
  private rpm = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    Object.assign(this.canvas.style, { position: 'fixed', left: '0', bottom: '0', width: '100%', height: '34%', pointerEvents: 'none', display: 'none' });
    this.canvas.className = 'dashboard';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  set visible(v: boolean) {
    this.shown = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  get visible() {
    return this.shown;
  }

  /** `gear`: 0 neutral, -1 reverse, 1..n (the race HUD hides its speed panel in this view, so the gear is here). */
  update(speedMph: number, rpm: number, maxRpm: number, gear?: number) {
    if (!this.shown) return;
    // Needles ease toward the value (a real gauge has some inertia).
    this.speed += (speedMph - this.speed) * 0.35;
    this.rpm += (rpm - this.rpm) * 0.35;
    const dpr = Math.min(devicePixelRatio, 2);
    const w = Math.round(this.canvas.clientWidth * dpr);
    const h = Math.round(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    const c = this.ctx;
    c.clearRect(0, 0, w, h);
    // The dash: a dark moulded panel with a curved top edge and a hood over the instruments.
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2a2d33');
    g.addColorStop(0.35, '#17191d');
    g.addColorStop(1, '#0b0c0e');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(0, h * 0.42);
    c.bezierCurveTo(w * 0.2, h * 0.3, w * 0.3, h * 0.04, w * 0.5, h * 0.04);
    c.bezierCurveTo(w * 0.7, h * 0.04, w * 0.8, h * 0.3, w, h * 0.42);
    c.lineTo(w, h);
    c.lineTo(0, h);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    c.lineWidth = 2 * dpr;
    c.stroke();
    const r = Math.min(h * 0.4, w * 0.12);
    const cy = h * 0.52;
    this.gauge(w * 0.5 - r * 1.4, cy, r, this.speed, 0, 240, 20, 'MPH', null, dpr);
    this.gauge(w * 0.5 + r * 1.4, cy, r, this.rpm / 1000, 0, Math.ceil(maxRpm / 1000) + 1, 1, 'RPM ×1000', maxRpm / 1000, dpr);
    // Digital speed under the gauges.
    c.fillStyle = '#ffcf4a';
    c.font = `bold ${Math.round(r * 0.28)}px ui-monospace, Menlo, Consolas, monospace`;
    c.textAlign = 'center';
    c.fillText(String(Math.round(this.speed)).padStart(3, ' '), w * 0.5, cy + r * 1.02);
    if (gear !== undefined) {
      // The gear in a lit box between the gauges.
      const s = r * 0.42;
      c.fillStyle = gear < 0 ? '#d83a2e' : '#ffcf4a';
      c.fillRect(w * 0.5 - s / 2, cy - s * 0.9, s, s);
      c.fillStyle = gear < 0 ? '#ffffff' : '#141414';
      c.font = `bold ${Math.round(s * 0.7)}px ui-monospace, Menlo, Consolas, monospace`;
      c.textBaseline = 'middle';
      c.fillText(gear < 0 ? 'R' : gear === 0 ? 'N' : String(gear), w * 0.5, cy - s * 0.4);
      c.textBaseline = 'alphabetic';
    }
  }

  private gauge(x: number, y: number, r: number, v: number, min: number, max: number, step: number, label: string, red: number | null, dpr: number) {
    const c = this.ctx;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    const ang = (t: number) => a0 + ((Math.min(Math.max(t, min), max) - min) / (max - min)) * (a1 - a0);
    c.save();
    // Bezel and face.
    c.beginPath();
    c.arc(x, y, r * 1.06, 0, Math.PI * 2);
    c.fillStyle = '#3a3e45';
    c.fill();
    const face = c.createRadialGradient(x, y - r * 0.3, r * 0.1, x, y, r);
    face.addColorStop(0, '#1d2127');
    face.addColorStop(1, '#07080a');
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    c.fillStyle = face;
    c.fill();
    if (red !== null) {
      c.beginPath();
      c.arc(x, y, r * 0.86, ang(red), a1);
      c.strokeStyle = '#d83a2e';
      c.lineWidth = r * 0.1;
      c.stroke();
    }
    c.strokeStyle = '#e9edf2';
    c.fillStyle = '#e9edf2';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `${Math.round(r * 0.15)}px system-ui, sans-serif`;
    for (let t = min; t <= max + 1e-6; t += step / 2) {
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      const a = ang(t);
      const r0 = major ? r * 0.76 : r * 0.82;
      c.beginPath();
      c.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      c.lineTo(x + Math.cos(a) * r * 0.92, y + Math.sin(a) * r * 0.92);
      c.lineWidth = (major ? 2.4 : 1.2) * dpr;
      c.stroke();
      if (major && (max - min) / step <= 13) c.fillText(String(t), x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
      else if (major && t % (step * 2) === 0) c.fillText(String(t), x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6);
    }
    c.font = `${Math.round(r * 0.12)}px system-ui, sans-serif`;
    c.fillStyle = '#9aa3ad';
    c.fillText(label, x, y + r * 0.42);
    // Needle.
    const a = ang(v);
    c.beginPath();
    c.moveTo(x - Math.cos(a) * r * 0.12, y - Math.sin(a) * r * 0.12);
    c.lineTo(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86);
    c.strokeStyle = '#ff5a2a';
    c.lineWidth = 3.2 * dpr;
    c.lineCap = 'round';
    c.stroke();
    c.beginPath();
    c.arc(x, y, r * 0.07, 0, Math.PI * 2);
    c.fillStyle = '#c9ced4';
    c.fill();
    c.restore();
  }
}
