import { useApp } from '../store/useApp';
import { getTasksGroupedByDueDate } from '../store/reducer';
import { TaskRow } from '../components/TaskRow';
import { todayDateString } from '../types';

function formatHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-');
  return `${m}/${d}/${y}`;
}

export function CalendarView() {
  const { state } = useApp();
  const today = todayDateString();
  const groups = getTasksGroupedByDueDate(state.tasks);

  return (
    <div className="view">
      <header className="view-header">
        <h1>Calendar</h1>
        <p className="subtitle">All tasks with a due date, grouped by date.</p>
      </header>

      {groups.length === 0 ? (
        <p className="empty">No dated tasks yet.</p>
      ) : (
        groups.map((group) => {
          const isOverdue = group.date < today;
          return (
            <section key={group.date} className="section calendar-day">
              <h2 className={isOverdue ? 'calendar-day-heading overdue' : 'calendar-day-heading'}>
                {formatHeading(group.date)}
                {isOverdue && <span className="badge overdue-badge">Overdue</span>}
              </h2>
              <ul className="task-list">
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <TaskRow task={task} showPrimaryToggle={task.status === 'Today'} showPostpone />
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
