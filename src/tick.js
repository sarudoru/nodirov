// The tick: one short, low sound each time a row passes the read head, the
// way a picker wheel clicks past its detents. Synthesized, so nothing is
// downloaded, and off until the visitor asks for it: browsers only let a
// page make sound after a click.

export function createTicker() {
  let context = null;
  let enabled = false;
  let last = 0;

  function ensure() {
    if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
    if (context.state === "suspended") context.resume();
    return context;
  }

  // A thock: a sine that drops from 150 to 70 Hz in 60 ms, a 6 ms burst of
  // low noise on the front for the contact, both through a low-pass so
  // nothing is bright.
  function thock(strength) {
    const ctx = ensure();
    const t = ctx.currentTime;
    const out = ctx.createBiquadFilter();
    out.type = "lowpass";
    out.frequency.value = 600;
    const master = ctx.createGain();
    master.gain.value = 0.22 * strength;
    out.connect(master).connect(ctx.destination);

    const body = ctx.createOscillator();
    body.type = "sine";
    body.frequency.setValueAtTime(150, t);
    body.frequency.exponentialRampToValueAtTime(70, t + 0.06);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(1, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.085);
    body.connect(bodyGain).connect(out);
    body.start(t);
    body.stop(t + 0.09);

    const burst = ctx.createBufferSource();
    const frames = Math.floor(ctx.sampleRate * 0.006);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    burst.buffer = buffer;
    const burstGain = ctx.createGain();
    burstGain.gain.value = 0.5;
    burst.connect(burstGain).connect(out);
    burst.start(t);
  }

  return {
    enabled: () => enabled,
    // must be called from a click: the first one unlocks the audio context
    toggle() {
      enabled = !enabled;
      if (enabled) thock(0.8);
      return enabled;
    },
    // rows: how many rows passed since the last frame; fast scrolling ticks
    // no more often than every 45 ms and a little louder
    tick(rows, now) {
      if (!enabled || rows === 0 || now - last < 45) return;
      last = now;
      thock(Math.min(1, 0.7 + Math.abs(rows) * 0.1));
    },
  };
}
