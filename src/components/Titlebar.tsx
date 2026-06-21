import { getCurrentWindow } from "@tauri-apps/api/window";

export function Titlebar(props: { hidden?: boolean }) {
  const appWindow = getCurrentWindow();

  function onDragStart(e: MouseEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    appWindow.startDragging();
  }

  return (
    <div
      class="titlebar"
      onMouseDown={onDragStart}
      style={props.hidden ? { opacity: "0", "pointer-events": "none" } : undefined}
    >
      <span class="titlebar-label">yaad</span>
      <div class="titlebar-actions">
        <button
          type="button"
          class="titlebar-btn minimize"
          aria-label="Minimize"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => appWindow.minimize()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
        <button
          type="button"
          class="titlebar-btn close"
          aria-label="Close"
          onMouseDown={e => e.stopPropagation()}
          onClick={() => appWindow.close()}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
