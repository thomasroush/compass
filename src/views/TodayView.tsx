import { useApp } from '../store/useApp';
import {
  getOverdueTasks,
  getTodayOtherTasks,
  getTodayPrimaryTasks,
} from '../store/reducer';
import { TaskRow } from '../components/TaskRow';
import { todayDateString } from '../types';

export function TodayView() {
  const { state } = useApp();
  const today = todayDateString();

  const primary = getTodayPrimaryTasks(state.tasks);
  const otherToday = getTodayOtherTasks(state.tasks);
  const overdue = getOverdueTasks(state.tasks, today);

  return (
    <div className="view">
      <header className="view-header">
        <h1>Today</h1>
        <p className="subtitle">{today}</p>
      </header>

      <section className="section">
        <h2>Primary tasks</h2>
        <p className="section-help">Choose up to three primary tasks for today.</p>
        {primary.length === 0 ? (
          <p className="empty">No primary tasks yet.</p>
        ) : (
          <ul className="task-list">
            {primary.map((task) => (
              <li key={task.id}>
                <TaskRow task={task} showPrimaryToggle showPostpone />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2>Other today tasks</h2>
        {otherToday.length === 0 ? (
          <p className="empty">No other tasks scheduled for today.</p>
        ) : (
          <ul className="task-list">
            {otherToday.map((task) => (
              <li key={task.id}>
                <TaskRow task={task} showPrimaryToggle showPostpone />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2>Overdue</h2>
        {overdue.length === 0 ? (
          <p className="empty">No overdue tasks.</p>
        ) : (
          <ul className="task-list">
            {overdue.map((task) => (
              <li key={task.id}>
                <TaskRow task={task} showPostpone />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
