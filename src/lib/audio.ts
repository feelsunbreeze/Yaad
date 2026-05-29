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

const sfx = {
  addTask: new Audio(addTaskSfx),
  focusTask: new Audio(focusTaskSfx),
  tabSwitch: new Audio(tabSwitchSfx),
  allDone: new Audio(allDoneSfx),
  snooze: new Audio(snoozeSfx),
  taskComplete: new Audio(taskCompleteSfx),
  dueNow: new Audio(dueNowSfx),
  notify1: new Audio(notify1Sfx),
  notify2: new Audio(notify2Sfx),
  notify3: new Audio(notify3Sfx),
  notify4: new Audio(notify4Sfx),
  notify5: new Audio(notify5Sfx),
};

let unlocked = false;

function unlockAudio() {
  if (unlocked) return;
  unlocked = true;
  
  // Play a tiny 1-byte silent WAV to unlock the browser's audio engine
  const silent = new Audio("data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA");
  silent.volume = 0;
  silent.play().catch(() => {});

  window.removeEventListener("keydown", unlockAudio);
  window.removeEventListener("mousedown", unlockAudio);
}

// Listen to the very first user interaction to unlock audio
if (typeof window !== "undefined") {
  window.addEventListener("keydown", unlockAudio, { capture: true, once: true });
  window.addEventListener("mousedown", unlockAudio, { capture: true, once: true });
}

export function playSfx(name: keyof typeof sfx) {
  const audio = sfx[name];
  if (!audio) return;
  
  const clone = audio.cloneNode() as HTMLAudioElement;
  clone.volume = 0.5;
  clone.play().catch(e => {
    console.warn("Audio playback failed:", e);
  });
}

export function playRandomNotify() {
  const notifies = ["notify1", "notify2", "notify3", "notify4", "notify5"] as const;
  const random = notifies[Math.floor(Math.random() * notifies.length)];
  playSfx(random);
}
