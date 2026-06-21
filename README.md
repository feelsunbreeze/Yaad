<div align="center">

<img src="src-tauri/icons/yaad.png" width="100" alt="Yaad logo" />

# Yaad

**Reminders that actually reach you.**

A calm, keyboard-first reminder app built for ADHD brains — no nags, no streaks, no guilt.  
Just a thought captured in two seconds, surfaced at the right moment.

[![License: MIT](https://img.shields.io/badge/license-MIT-c89537?style=flat-square)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/built%20with-Tauri%202-492e0a?style=flat-square&logo=tauri)](https://tauri.app)
[![SolidJS](https://img.shields.io/badge/UI-SolidJS-b8924a?style=flat-square&logo=solid)](https://solidjs.com)
[![Rust](https://img.shields.io/badge/core-Rust-f5bf57?style=flat-square&logo=rust&logoColor=492e0a)](https://www.rust-lang.org)

[**Download**](#-download) · [**Ko-fi**](https://ko-fi.com/feelsunbreeze) · [**The Marginalia**](https://themarginalia.app)

</div>

---

## What is Yaad?

Yaad (یاد — Urdu for *"remember"*) is a desktop reminder app that fires native OS notifications with built-in jitter and pattern-interrupt framing — so they actually cut through the noise.

It's designed around one truth: **a reminder is useless if you don't notice it.**

No account required. No cloud. No telemetry. Everything lives on your machine in a single SQLite file. It works on a plane, in a coffee shop, and through a reboot.

---

## ✨ Features

- **⚡ Instant capture** — type a reminder and press Enter. Done. Two seconds, no mouse.
- **🔔 Smart notifications** — powered by [Honker](https://honker.dev), a durable queue built into SQLite. Notifications are transactional: if the app crashes or your laptop sleeps through the fire time, they still deliver on next wake.
- **😮‍💨 Shame-free** — no missed-item counters, no red badges, no streak breaks. Past-due items show *"from yesterday"*, not *"OVERDUE 14h 23m"*.
- **💤 Snooze is a first-class verb** — reschedule anything in one click. Missing things is normal.
- **⌨️ Keyboard-first** — navigate, complete, and snooze without touching the mouse. Tab between Today and Upcoming with `Ctrl+Tab`.
- **🎯 Two views** — *Today* (what's due now) and *Upcoming* (everything else).
- **🔒 Fully local** — one `.db` file on your disk. No account. No sync server. No surveillance.
- **🪶 Tiny** — Boots in under a second.

---

## 🧠 Built for ADHD

Most reminder apps are built for people who just need a nudge. Yaad is built for people whose brain will actively ignore a nudge unless it's delivered in exactly the right way, at the right moment, with zero friction to act.

Concretely, this means:

| What most apps do | What Yaad does |
|---|---|
| Stack up missed reminders | Collapse backlog into one calm card |
| Show streak counters | Show nothing (streaks create shame) |
| Escalate nagging | Quiet by default, escalation is opt-in per reminder |
| Use red for overdue | Neutral text + a soft dot |
| Require five taps to snooze | One click |
| Need an account to work | Zero network, zero account |

---

## 🛠 Tech Stack

| Layer | Technology |
|---|---|
| Shell | [Tauri 2](https://tauri.app) — native window, OS integrations |
| UI | [SolidJS](https://solidjs.com) + Vite — fine-grained reactivity, ~7 KB runtime |
| Core | [Rust](https://rust-lang.org) — scheduler, notifier, IPC |
| Database | SQLite via [rusqlite](https://github.com/rusqlite/rusqlite) (bundled) |
| Queue / Scheduler | [Honker](https://honker.dev) — durable queues + cron inside SQLite |
| Fonts | Lora (display) · DM Sans (body) — self-hosted via `@fontsource` |
| Packaging | NSIS (Windows) · DMG (macOS) · `.deb` + AppImage (Linux) |

---

## 📥 Download

| Platform | Architecture | Download |
|---|---|---|
| **Windows** | x64 | [Yaad_1.0.0_x64-setup.exe](https://github.com/feelsunbreeze/Yaad/releases/latest) |
| **macOS** | Apple Silicon (M1/M2/M3) | [Yaad_1.0.0_aarch64.dmg](https://github.com/feelsunbreeze/Yaad/releases/latest) |
| **macOS** | Intel | [Yaad_1.0.0_x64.dmg](https://github.com/feelsunbreeze/Yaad/releases/latest) |
| **Linux** | x86_64 | [Yaad_1.0.0_amd64.deb](https://github.com/feelsunbreeze/Yaad/releases/latest) · [Yaad_1.0.0_x86_64.AppImage](https://github.com/feelsunbreeze/Yaad/releases/latest) |

> Releases are not signed!

---

## 🔨 Build from Source

**Prerequisites:** [Rust](https://rustup.rs) stable · [Node.js](https://nodejs.org) 18+ · [pnpm](https://pnpm.io)

```bash
# Clone
git clone https://github.com/feelsunbreeze/Yaad.git
cd Yaad

# Install JS dependencies
pnpm install

# Run in dev mode (hot-reload UI + Rust backend)
pnpm tauri dev

# Build a release binary + installer for your platform
pnpm tauri build
```

Built artifacts land in `src-tauri/target/release/bundle/`.

---

## 🤝 Contributing

Yaad is open source and I'd love your help. A few things to know before you open a PR:

1. **Read the philosophy first.** The UX principles in this repo are hard constraints — every change gets evaluated against *"does this add cognitive load for an ADHD user?"*. If the answer is yes, it probably doesn't ship.
2. **No gamification.** No streaks, scores, badges, or any feature that makes missing a reminder feel like a failure.
3. **No telemetry.** Ever.
4. **Reminders must fire deterministically.** AI and network are optional edges — the scheduling loop is 100% local SQLite + Honker.

Otherwise — bugs, perf improvements, accessibility, translations — all very welcome. Open an issue first for anything large so we can align on direction.

---

## ☕ Support

Yaad is free, open-source, and built out of genuine love for a problem that affects a lot of people.

If it's helped you, a Ko-fi goes a long way toward keeping the lights on:

[![Support on Ko-fi](https://img.shields.io/badge/Support%20on-Ko--fi-f5bf57?style=for-the-badge&logo=ko-fi&logoColor=492e0a)](https://ko-fi.com/feelsunbreeze)

---

## 📄 License

MIT © [Sunbreeze](https://feelsunbreeze.com)

---

<div align="center">
  <sub>Made with a lot of love (and a few missed reminders) by <a href="https://feelsunbreeze.com">Sunbreeze</a></sub>
</div>
