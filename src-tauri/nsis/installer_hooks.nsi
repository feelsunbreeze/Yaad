; ─────────────────────────────────────────────────────────────────────────────
; Yaad NSIS Installer Hooks
; Publisher: Sunbreeze  (https://feelsunbreeze.com)
;
; These macros are called by the Tauri-generated NSIS template at specific
; lifecycle points. Do NOT write a full installer here — only use the hooks
; listed below.  Tauri bundles this file via the nsis.installerHooks config.
; ─────────────────────────────────────────────────────────────────────────────

; ── Post-install hook ────────────────────────────────────────────────────────
; Runs after all application files have been written to disk.
!macro NSIS_HOOK_POSTINSTALL
  ; Write extra publisher metadata into the Windows uninstall registry entry.
  ; Tauri writes the basics (DisplayName, DisplayVersion, UninstallString) but
  ; not Publisher, URLInfoAbout, or Comments — we add those here.
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
    "Publisher" "Sunbreeze"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
    "URLInfoAbout" "https://yaad.feelsunbreeze.com"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
    "URLUpdateInfo" "https://yaad.feelsunbreeze.com"
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
    "Comments" "ADHD-aware reminders that surface when you'll actually notice."
  WriteRegStr SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}" \
    "Contact" "matthiassunbreeze@gmail.com"
!macroend

; ── Pre-uninstall hook ───────────────────────────────────────────────────────
; Runs before files are removed during uninstallation.
!macro NSIS_HOOK_PREUNINSTALL
  ; Nothing extra to clean up before uninstall — Tauri handles all files.
!macroend

; ── Post-uninstall hook ──────────────────────────────────────────────────────
; Runs after all application files have been removed.
!macro NSIS_HOOK_POSTUNINSTALL
  ; Nothing extra needed after uninstall.
!macroend
