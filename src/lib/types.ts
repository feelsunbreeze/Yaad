export type Tab = "today" | "upcoming" | "done";

export type TagTone = "warm" | "green" | "red" | "muted";

export type SnoozePreset = string;

export interface ReminderTag {
  label: string;
  tone: TagTone;
}

export interface Reminder {
  id: string;
  title: string;
  timeLabel: string | null;
  fireAt: number | null;
  completedAt: number | null;
  done: boolean;
  urgent: boolean;
  tag: ReminderTag | null;
  bucket: Exclude<Tab, "done">;
}

export interface QuickTag {
  id: string;
  label: string;
  injectPrefix: string | null;
}
