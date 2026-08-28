import { TASK_STATUSES, type TaskStatus } from '../types';

interface StatusSelectProps {
  id: string;
  value: TaskStatus;
  onChange: (status: TaskStatus) => void;
  label?: string;
}

export function StatusSelect({ id, value, onChange, label = 'Status' }: StatusSelectProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as TaskStatus)}
      >
        {TASK_STATUSES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    </div>
  );
}
