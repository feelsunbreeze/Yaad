export interface ProgressBarProps {
  done: number;
  total: number;
  percent: number;
}

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
