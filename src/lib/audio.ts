/**
 * Yaad's audio engine (Web Audio API).
 *
 * ── The bug this is designed to avoid ────────────────────────────────────────
 * An AudioContext created outside a user gesture starts `suspended`. The fatal
 * mistake is to call `source.start()` while it's still suspended (or mid-resume)
 * — the one-shot is silently dropped, so the FIRST sounds after launch never
 * play, and things only "wake up" once some later sound happens to fire after
 * the context finished resuming. To prevent that, `playSfx` NEVER starts a
 * source until the context is actually `running`: if it isn't, we `resume()`
 * first and play in the `.then()`.
 *
 * Pieces:
 *   1. Each clip is decoded ONCE into an AudioBuffer (no per-play decode).
 *   2. A user-gesture `unlock()` that RETRIES on every gesture until the
 *      context truly reaches `running` (a single `{ once: true }` listener is
 *      the trap — if the first resume hasn't resolved, you've lost your only
 *      shot).
 *   3. A continuous, inaudible keep-alive source that holds the output device
 *      open so it never sleeps — the first sound after any idle is instant.
 *
 * Mute: a single in-memory flag, driven by the persisted `sound_enabled`
 * setting. When muted, `playSfx` early-returns before creating any source.
 *
 * The exported surface (`playSfx`, `playRandomNotify`, `setSfxMuted`,
 * `isSfxMuted`) is unchanged, so call sites don't need to know any of this.
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

// ── Mute ──────────────────────────────────────────────────────────────────
let muted = false;

/** Toggle all sound effects on/off. Driven by the `sound_enabled` setting. */
export function setSfxMuted(value: boolean): void {
  muted = value;
}

/** Current mute state — handy for initialising a settings toggle. */
export function isSfxMuted(): boolean {
  return muted;
}

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
 *  load so buffers are warm by the time the user first interacts. */
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

/**
 * The keep-alive: a silent, looping one-second buffer through a zero-gain node.
 * While it plays, the OS keeps the output device open AND the context stays
 * `running`, so every subsequent sound fires instantly with no warm-up clip.
 */
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
    /* already started or context not ready — harmless */
  }

  keepAlive = { source, gain };

  if (keepAliveTimer === undefined) {
    keepAliveTimer = window.setInterval(() => {
      if (ctx && ctx.state === "suspended") void ctx.resume();
    }, 10_000);
  }
}

/**
 * Unlock on a user gesture. Registered WITHOUT `{ once: true }` and retried on
 * every gesture until the context actually reaches `running` — only then do we
 * detach. (The classic failure is a single once-listener that resumes before
 * the gesture is honored, leaving the context suspended forever.)
 */
function unlock(): void {
  const c = ensureContext();
  if (!c) return;
  void (async () => {
    try {
      if (c.state !== "running") await c.resume();
    } catch {
      /* not honored yet — a later gesture will retry */
    }
    await decodeAll();
    if (c.state === "running") {
      startKeepAlive();
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
  // Decode ASAP so buffers are warm; decoding does not need a running context.
  void decodeAll();

  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("mousedown", unlock, true);
  window.addEventListener("keydown", unlock, true);
  window.addEventListener("touchstart", unlock, true);

  // Re-warm when the window regains focus (a reminder may have fired while the
  // app was hidden and the OS suspended the context).
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void resumeCtx();
  });
}

/** Resume the context if suspended. */
async function resumeCtx(): Promise<void> {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended") {
    try {
      await c.resume();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Play a one-shot sound effect.
 *
 * The critical ordering: a source is only ever started while the context is
 * `running`. If it's still `suspended` (e.g. the very first sound right after
 * launch, before the gesture-driven resume has resolved), we resume first and
 * play in the `.then()` — so the sound is delayed by a few ms rather than
 * silently dropped.
 */
export function playSfx(name: SfxName): void {
  if (muted) return;
  const c = ensureContext();
  if (!c || !masterGain) return;

  const play = () => {
    if (muted) return;
    const buf = buffers.get(name);
    if (buf) {
      fire(c, masterGain!, buf);
      return;
    }
    // Buffer not decoded yet — decode just this one, then play (still gated on
    // running, since this resolves asynchronously).
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
  };

  if (c.state === "running") {
    play();
  } else {
    // Resume, THEN play. Also (re)start the keep-alive so it stays running.
    c.resume()
      .then(() => {
        startKeepAlive();
        play();
      })
      .catch(() => {
        /* not yet permitted — next gesture's unlock() will bring it up */
      });
  }
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
