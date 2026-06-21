import { createSignal } from "solid-js";

export interface ToastState {
  id: number;
  message: string;
}

const [toast, setToast] = createSignal<ToastState | null>(null);
let nextId = 0;

export function showToast(message: string) {
  setToast({ id: nextId++, message });
}

export function clearToast(id: number) {
  setToast(current => (current?.id === id ? null : current));
}

export function useToast() {
  return { toast };
}
