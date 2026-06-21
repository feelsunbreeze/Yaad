import addTaskSfx from "../assets/sfx/add_task.wav";
import focusTaskSfx from "../assets/sfx/focus_task.wav";
import tabSwitchSfx from "../assets/sfx/tab_switch.wav";
import allDoneSfx from "../assets/sfx/all_done.wav";
import snoozeSfx from "../assets/sfx/snooze.wav";
import snoozeCurrentSfx from "../assets/sfx/snooze_current.wav";
import taskCompleteSfx from "../assets/sfx/task_complete.wav";
import dueNowSfx from "../assets/sfx/due_now.wav";
import sortSfx from "../assets/sfx/sort.wav";
import notify1Sfx from "../assets/sfx/notify_1.wav";
import notify2Sfx from "../assets/sfx/notify_2.wav";
import notify3Sfx from "../assets/sfx/notify_3.wav";
import notify4Sfx from "../assets/sfx/notify_4.wav";
import notify5Sfx from "../assets/sfx/notify_5.wav";

const SOURCES = {
  addTask: addTaskSfx,
  focusTask: focusTaskSfx,
  tabSwitch: tabSwitchSfx,
  allDone: allDoneSfx,
  snooze: snoozeSfx,
  snoozeCurrent: snoozeCurrentSfx,
  taskComplete: taskCompleteSfx,
  dueNow: dueNowSfx,
  sort: sortSfx,
  notify1: notify1Sfx,
  notify2: notify2Sfx,
  notify3: notify3Sfx,
  notify4: notify4Sfx,
  notify5: notify5Sfx,
} as const;

export type SfxName = keyof typeof SOURCES;

const DEFAULT_GAIN = 0.5;
const MAX_PENDING_AGE = 1500;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const buffers = new Map<SfxName, AudioBuffer>();
let decodeStarted = false;
let keepAlive: { source: AudioBufferSourceNode | OscillatorNode; gain: GainNode } | null = null;
let keepAliveTimer: number | undefined;
let pending: { name: SfxName; at: number }[] = [];

let muted = false;
export function setSfxMuted(value: boolean): void {
  muted = value;
}
export function isSfxMuted(): boolean {
  return muted;
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  if (typeof window === "undefined") return null;

  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;

  ctx = new Ctor();
  masterGain = ctx.createGain();
  masterGain.gain.value = DEFAULT_GAIN;
  masterGain.connect(ctx.destination);
  return ctx;
}

async function decodeAll(): Promise<void> {
  const c = ensureContext();
  if (!c || decodeStarted) return;
  decodeStarted = true;

  await Promise.all(
    (Object.keys(SOURCES) as SfxName[]).map(async name => {
      try {
        const res = await fetch(SOURCES[name]);
        const arr = await res.arrayBuffer();
        const buf = await c.decodeAudioData(arr);
        buffers.set(name, buf);
      } catch (e) {
        console.warn(`[audio] failed to decode ${name}:`, e);
      }
    }),
  );
}

function startKeepAlive(): void {
  if (!ctx || keepAlive) return;
  const source = ctx.createOscillator();
  source.type = "sine";
  source.frequency.value = 10;

  const gain = ctx.createGain();
  gain.gain.value = 0.001;

  source.connect(gain).connect(ctx.destination);
  try {
    source.start();
  } catch {
    /* harmless */
  }
  keepAlive = { source, gain };

  if (keepAliveTimer === undefined) {
    keepAliveTimer = window.setInterval(() => {
      if (ctx && ctx.state === "suspended") void ctx.resume();
    }, 10_000);
  }
}

function playNow(name: SfxName): void {
  if (muted) return;
  const c = ctx;
  if (!c || !masterGain) return;

  const buf = buffers.get(name);
  if (buf) {
    fire(c, masterGain, buf);
    return;
  }
  void (async () => {
    try {
      const res = await fetch(SOURCES[name]);
      const decoded = await c.decodeAudioData(await res.arrayBuffer());
      buffers.set(name, decoded);
      if (!muted && c.state === "running") fire(c, masterGain!, decoded);
    } catch (e) {
      console.warn(`[audio] playback failed for ${name}:`, e);
    }
  })();
}

function flushPending(): void {
  if (!ctx || ctx.state !== "running" || pending.length === 0) return;
  const now = Date.now();
  const items = pending;
  pending = [];
  for (const it of items) {
    if (now - it.at <= MAX_PENDING_AGE) playNow(it.name);
  }
}

function fire(c: AudioContext, dest: GainNode, buf: AudioBuffer): void {
  try {
    const source = c.createBufferSource();
    source.buffer = buf;
    source.connect(dest);
    source.start();
  } catch (e) {
    console.warn("[audio] source start failed:", e);
  }
}

export function playSfx(name: SfxName): void {
  if (muted) return;
  const c = ensureContext();
  if (!c || !masterGain) return;

  if (c.state === "running") {
    playNow(name);
    return;
  }

  pending.push({ name, at: Date.now() });
  c.resume()
    .then(() => {
      startKeepAlive();
      flushPending();
    })
    .catch(() => {});
}

export function playRandomNotify(): void {
  const notifies: SfxName[] = ["notify1", "notify2", "notify3", "notify4", "notify5"];
  playSfx(notifies[Math.floor(Math.random() * notifies.length)]);
}

function unlock(): void {
  const c = ensureContext();
  if (!c) return;
  void (async () => {
    try {
      if (c.state !== "running") await c.resume();
    } catch {
      /* a later gesture will retry */
    }
    await decodeAll();
    if (c.state === "running") {
      startKeepAlive();
      flushPending();
      detachUnlock();
    }
  })();
}

function detachUnlock(): void {
  window.removeEventListener("pointerdown", unlock, true);
  window.removeEventListener("mousedown", unlock, true);
  window.removeEventListener("keydown", unlock, true);
  window.removeEventListener("touchstart", unlock, true);
}

if (typeof window !== "undefined") {
  void decodeAll();

  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("mousedown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("touchstart", unlock, true);

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && ctx && ctx.state === "suspended") {
      void ctx.resume().then(flushPending).catch(() => {});
    }
  });
}

const keyboardSounds = import.meta.glob<string>("../assets/sfx/keyboard/*.wav", { eager: true, import: "default", query: "?url" });
const keyboardBuffers = new Map<string, AudioBuffer>();

export function playKeyboardSfx(key: string): void {
  if (muted) return;
  const c = ensureContext();
  if (!c || !masterGain || c.state !== "running") return;

  const normalizedKey = key.toLowerCase();
  let filename = "";
  if (/^[a-z]$/.test(normalizedKey)) filename = normalizedKey;
  else if (normalizedKey === " " || normalizedKey === "space") filename = "space";
  else if (normalizedKey === "backspace") filename = "backspace";
  else if (normalizedKey === "," || normalizedKey === "comma") filename = "y";
  else if (normalizedKey === "." || normalizedKey === "period") filename = "e";
  else return;

  const buf = keyboardBuffers.get(filename);
  if (buf) {
    if (buf.length > 1) fire(c, masterGain, buf);
    return;
  }

  const path = keyboardSounds[`../assets/sfx/keyboard/${filename}.wav`];
  if (!path) return;

  keyboardBuffers.set(filename, c.createBuffer(1, 1, c.sampleRate));

  void (async () => {
    try {
      const res = await fetch(path);
      const decoded = await c.decodeAudioData(await res.arrayBuffer());
      keyboardBuffers.set(filename, decoded);
      if (!muted && c.state === "running") fire(c, masterGain!, decoded);
    } catch (e) {
      console.warn(`[audio] keyboard playback failed for ${filename}:`, e);
      keyboardBuffers.delete(filename);
    }
  })();
}
