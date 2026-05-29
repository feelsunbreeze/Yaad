/**
 * Yaad's audio engine.
 *
 * ── Why Web Audio and not `new Audio()` ──────────────────────────────────────
 * The previous implementation used HTML `<audio>` elements (`new Audio(url)`)
 * and `.cloneNode()` per play. That has a fatal flaw for an app like this:
 * when nothing has played for a while, the WebView's audio OUTPUT SINK goes to
 * sleep (the OS releases the device). The next `.play()` has to spin the device
 * back up, and the attack of the first sound is dropped or clipped — exactly
 * the "first interaction after idle plays nothing" bug. For a reminder app the
 * single most important sound (a notification firing an hour after you set it)
 * is ALWAYS the first sound after a long idle, so it was the one most reliably
 * swallowed.
 *
 * The Web Audio API fixes this cleanly:
 *   1. Each clip is decoded ONCE into an AudioBuffer (no per-play decode, no
 *      element churn, no GC pressure).
 *   2. A continuous, inaudible keep-alive source holds the output device open
 *      so it never sleeps — the first "real" sound after any idle is instant
 *      and complete.
 *   3. Every play resumes the context first (covers the window-hidden /
 *      OS-suspended case when a reminder fires while minimised).
 *
 * The exported surface (`playSfx`, `playRandomNotify`) is unchanged, so call
 * sites don't need to know any of this.
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

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const buffers = new Map<SfxName, AudioBuffer>();
let decodeStarted = false;
let keepAlive: { source: AudioBufferSourceNode; gain: GainNode } | null = null;
let keepAliveTimer: number | undefined;

/** Lazily create the AudioContext + master gain. Created suspended on most
 *  platforms; `unlock()` / `resume()` brings it live after a user gesture. */
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

/** Decode every clip into an AudioBuffer exactly once. Fired eagerly at module
 *  load so buffers are warm by the time the user first interacts; safe to call
 *  again (guarded by `decodeStarted`). */
async function decodeAll(): Promise<void> {
  const c = ensureContext();
  if (!c || decodeStarted) return;
  decodeStarted = true;

  await Promise.all(
    (Object.keys(SOURCES) as SfxName[]).map(async name => {
      try {
        const res = await fetch(SOURCES[name]);
        const arr = await res.arrayBuffer();
        // decodeAudioData works while the context is suspended.
        const buf = await c.decodeAudioData(arr);
        buffers.set(name, buf);
      } catch (e) {
        console.warn(`[audio] failed to decode ${name}:`, e);
      }
    }),
  );
}

/**
 * The keep-alive: a silent, looping one-second buffer routed through a
 * (near-)zero gain node. While it plays, the OS keeps the output device open,
 * so the first audible sound after any idle window fires instantly and
 * complete — no warm-up clip. Cost is negligible (a zero-amplitude buffer).
 */
function startKeepAlive(): void {
  if (!ctx || !masterGain || keepAlive) return;

  const silent = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const source = ctx.createBufferSource();
  source.buffer = silent;
  source.loop = true;

  const gain = ctx.createGain();
  gain.gain.value = 0; // truly inaudible — only there to hold the device open
  source.connect(gain).connect(ctx.destination);
  source.start();

  keepAlive = { source, gain };

  // Belt-and-braces: if the OS suspends the context anyway (window hidden,
  // sleep), nudge it back awake periodically so a fire-while-minimised still
  // produces sound the instant the event arrives.
  if (keepAliveTimer === undefined) {
    keepAliveTimer = window.setInterval(() => {
      if (ctx && ctx.state === "suspended") void ctx.resume();
    }, 10_000);
  }
}

/** Resume the context (no-op if already running). Browsers/WebViews require
 *  the first resume to follow a user gesture; after that it can be called
 *  programmatically, including from a notification-fired handler. */
async function resume(): Promise<void> {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* ignore — will retry on next play */
    }
  }
}

/** First user gesture unlocks + warms the whole engine. */
function unlock(): void {
  void (async () => {
    await resume();
    await decodeAll();
    startKeepAlive();
  })();
  window.removeEventListener("keydown", unlock, true);
  window.removeEventListener("mousedown", unlock, true);
  window.removeEventListener("touchstart", unlock, true);
}

if (typeof window !== "undefined") {
  // Kick off decoding immediately so buffers are ready ASAP; the context may
  // be suspended until the gesture, but decodeAudioData does not need it live.
  void decodeAll();

  window.addEventListener("keydown", unlock, { capture: true, once: true });
  window.addEventListener("mousedown", unlock, { capture: true, once: true });
  window.addEventListener("touchstart", unlock, { capture: true, once: true });

  // Re-warm when the window regains focus (a reminder may have fired while the
  // app was hidden and the context got suspended by the OS).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void resume();
  });
}

/**
 * Play a one-shot sound effect. Safe to call before the engine is fully warm:
 * it resumes the context, and if the buffer hasn't decoded yet it falls back
 * to a lazy decode so nothing is silently lost.
 */
export function playSfx(name: SfxName): void {
  const c = ensureContext();
  if (!c || !masterGain) return;

  void resume();

  const buf = buffers.get(name);
  if (buf) {
    fire(c, masterGain, buf);
    return;
  }

  // Not decoded yet — decode just this one, then play.
  void (async () => {
    try {
      const res = await fetch(SOURCES[name]);
      const arr = await res.arrayBuffer();
      const decoded = await c.decodeAudioData(arr);
      buffers.set(name, decoded);
      await resume();
      fire(c, masterGain!, decoded);
    } catch (e) {
      console.warn(`[audio] playback failed for ${name}:`, e);
    }
  })();
}

/** Spin up a fresh BufferSource (one-shot, GC'd after it ends) → master gain. */
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

/** Pick one of the five notify tones at random. Used for pre-deadline nudges. */
export function playRandomNotify(): void {
  const notifies: SfxName[] = ["notify1", "notify2", "notify3", "notify4", "notify5"];
  playSfx(notifies[Math.floor(Math.random() * notifies.length)]);
}
