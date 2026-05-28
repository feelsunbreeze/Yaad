export interface ProgressBarProps {
  /** How many reminders the user has marked done. */
  done: number;
  /** Total reminder count across all buckets. */
  total: number;
  /**
   * Pre-computed percent (0..100). We accept this as a prop rather than
   * deriving it inline so the parent's `createMemo` keeps the value cached
   * and reactive — and so the displayed label can never drift from the
   * width of the fill bar.
   */
  percent: number;
}

/**
 * The "3 of 7 done — 42%" row plus the amber-gradient fill bar.
 * Width of `.progress-fill` is driven by inline `style.width`; CSS animates
 * the initial scaleX(0) → scaleX(1) entrance once on mount.
 */
export function ProgressBar(props: ProgressBarProps) {
  return (
    <div class="progress-wrap">
      <div class="progress-label">
        <span>
          {props.done} of {props.total} done
        </span>
        <span>{props.percent}%</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style={{ width: `${props.percent}%` }} />
      </div>
    </div>
  );
}
