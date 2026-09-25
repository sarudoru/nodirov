// The tick: one short, deep sound each time a row of flaps turns over, the
// way a picker wheel clicks into its detents. Synthesized once into a
// buffer, so nothing is downloaded and every tick is a cheap playback. Off
// until the visitor asks for it: browsers only let a page make sound after
// a click.

// A thock: a low body falling from 160 to 75 Hz, a short knock from the
// case, and a few milliseconds of filtered noise for the contact, all under
// a low-pass so nothing is bright.
async function renderThock(sampleRate) {
  const length = 0.11;
  const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * length), sampleRate);
  const out = ctx.createBiquadFilter();
  out.type = "lowpass";
  out.frequency.value = 2200;
  out.Q.value = 0.4;
  out.connect(ctx.destination);

  const envelope = (node, peak, attack, decay) => {
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, 0);
    gain.gain.exponentialRampToValueAtTime(peak, attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, decay);
    node.connect(gain).connect(out);
  };

  const body = ctx.createOscillator();
  body.type = "sine";
  body.frequency.setValueAtTime(160, 0);
  body.frequency.exponentialRampToValueAtTime(75, 0.05);
  envelope(body, 0.9, 0.002, 0.075);
  body.start(0);
  body.stop(0.08);

  const knock = ctx.createOscillator();
  knock.type = "triangle";
  knock.frequency.setValueAtTime(430, 0);
  knock.frequency.exponentialRampToValueAtTime(300, 0.03);
  envelope(knock, 0.22, 0.001, 0.032);
  knock.start(0);
  knock.stop(0.04);

  const frames = Math.floor(sampleRate * 0.006);
  const buffer = ctx.createBuffer(1, frames, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const contact = ctx.createBufferSource();
  contact.buffer = buffer;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1700;
  band.Q.value = 0.9;
  contact.connect(band);
  envelope(band, 0.5, 0.0005, 0.008);
  contact.start(0);

  return ctx.startRendering();
}

export function createTicker() {
  let context = null;
  let thock = null;
  let enabled = false;
  let last = 0;

  function play(strength, pitch = 1) {
    if (!context || !thock) return;
    const source = context.createBufferSource();
    source.buffer = thock;
    // no two ticks quite alike, or a fast scroll sounds like a machine
    source.playbackRate.value = pitch * (0.94 + Math.random() * 0.1);
    const gain = context.createGain();
    gain.gain.value = 0.32 * strength;
    source.connect(gain).connect(context.destination);
    source.start();
  }

  return {
    enabled: () => enabled,
    // must be called from a click: the first one unlocks the audio context
    toggle() {
      enabled = !enabled;
      if (enabled) {
        if (!context) context = new (window.AudioContext || window.webkitAudioContext)();
        if (context.state === "suspended") context.resume();
        if (thock) play(0.8);
        else renderThock(context.sampleRate).then((buffer) => {
          thock = buffer;
          play(0.8);
        });
      }
      return enabled;
    },
    // rows: how many rows turned since the last call; fast scrolling ticks
    // no more often than every 40 ms and a little louder
    tick(rows, now) {
      if (!enabled || rows === 0 || now - last < 40) return;
      last = now;
      play(Math.min(1, 0.65 + Math.abs(rows) * 0.12));
    },
    // a typed letter lands with a smaller, higher click
    key() {
      if (enabled) play(0.3, 1.7);
    },
  };
}
