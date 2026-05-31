/**
 * Yaad's audio engine (Web Audio API).
 *
 * ── The bug this is built to avoid ───────────────────────────────────────────
 * An AudioContext created outside a user gesture starts `suspended`. Calling
 * `source.start()` while it's still suspended (or mid-resume) SILENTLY DROPS
 * the one-shot. So any sound fired before the context is `running` is lost —
 * which is every SFX triggered after an `await` (addTask, snooze) or on a
 * non-gesture event (focus), right after launch. They only start working once
 * something resumes the context in-gesture (e.g. completing a task) and the
 * keep-alive holds it open — hence "it wakes up after I complete one."
 *
 * The rules here, so NO sound is ever dropped:
 *   1. `playSfx` NEVER starts a source unless the context is `running`.
 *   2. If it isn't running, the sound is QUEUED and we `resume()`; the queue is
 *      flushed the instant the context reaches `running` (on this resume, or on
 *      the next user gesture via `unlock()`). A short staleness guard stops a
 *      long-deferred sound from blaring out later.
 *   3. `unlock()` retries on EVERY gesture until the context truly runs (a lone
 *      `{ once:true }` listener that fires before the resume is honored is the
 *      classic trap).
 *   4. A silent keep-alive source holds the device + context open so, after the
 *      first success, every later sound is instant.
 */

import addTaskSfx from "../assets/sfx/add_task.wav";
import focusTaskSfx from "../assets/sfx/focus_task.wav";
import tabSwitchSfx from "../assets/sfx/tab_switch.wav";
import allDoneSfx from "../assets/sfx/all_done.wav";
import snoozeSfx from "../assets/sfx/snooze.wav";
import taskCompleteSfx from "../assets/sfx/task_complete.wav";
import dueNowSfx from "../assets/sfx/due_now.wav";
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
  taskComplete: taskCompleteSfx,
  dueNow: dueNowSfx,
  notify1: notify1Sfx,
  notify2: notify2Sfx,
  notify3: notify3Sfx,
  notify4: notify4Sfx,
  notify5: notify5Sfx,
} as const;

export type SfxName = keyof typeof SOURCES;

const DEFAULT_GAIN = 0.5;
/** Don't fire a queued sound if it's been waiting longer than this (ms) — a
 *  stale UI tick blaring out seconds later is worse than silence. */
const MAX_PENDING_AGE = 1500;

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const buffers = new Map<SfxName, AudioBuffer>();
let decodeStarted = false;
let keepAlive: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let keepAliveTimer: number | undefined;
let pending: { name: SfxName; at: number }[] = [];

// ── Mute ──────────────────────────────────────────────────────────────────
let muted = false;
export function setSfxMuted(value: boolean): void {
  muted = value;
}
export function isSfxMuted(): boolean {
  return muted;
}

/** Lazily create the AudioContext + master gain (suspended until a gesture). */
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

/** Decode every clip into an AudioBuffer exactly once, eagerly at module load. */
async function decodeAll(): Promise<void> {
  const c = ensureContext();
  if (!c || decodeStarted) return;
  decodeStarted = true;

  await Promise.all(
    (Object.keys(SOURCES) as SfxName[]).map(async name => {
      try {
        const res = await fetch(SOURCES[name]);
        const arr = await res.arrayBuffer();
        const buf = await c.decodeAudioData(arr); // works while suspended
        buffers.set(name, buf);
      } catch (e) {
        console.warn(`[audio] failed to decode ${name}:`, e);
      }
    }),
  );
}

/** Silent looping buffer that keeps the context `running` + the device awake. */
function startKeepAlive(): void {
  if (!ctx || keepAlive) return;
  const silent = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = silent;
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.value = 0;
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

/** Play `name` immediately — context MUST already be running when this runs. */
function playNow(name: SfxName): void {
  if (muted) return;
  const c = ctx;
  if (!c || !masterGain) return;

  const buf = buffers.get(name);
  if (buf) {
    fire(c, masterGain, buf);
    return;
  }
  // Not decoded yet — decode this one, then fire if still running.
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

/** Fire any queued sounds (dropping stale ones) once the context is running. */
function flushPending(): void {
  if (!ctx || ctx.state !== "running" || pending.length === 0) return;
  const now = Date.now();
  const items = pending;
  pending = [];
  for (const it of items) {
    if (now - it.at <= MAX_PENDING_AGE) playNow(it.name);
  }
}

/** Fresh one-shot BufferSource → master gain. */
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

/**
 * Public play. If the context is running, play now. Otherwise queue the sound
 * and resume — the queue flushes the moment the context is running, so the
 * sound is delayed by a few ms instead of being silently dropped.
 */
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
    .catch(() => {
      /* not permitted yet — the next gesture's unlock() will resume + flush */
    });
}

/** Pick one of the five notify tones at random. */
export function playRandomNotify(): void {
  const notifies: SfxName[] = ["notify1", "notify2", "notify3", "notify4", "notify5"];
  playSfx(notifies[Math.floor(Math.random() * notifies.length)]);
}

// ── Gesture unlock — retries until the context actually runs ────────────────
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
