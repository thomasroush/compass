import { useApp } from '../store/useApp';
import { getTasksGroupedByDueDate } from '../store/reducer';
import { TaskRow } from '../components/TaskRow';
import { todayDateString } from '../types';

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en-US', { weekday: 'long' });
const MONTH_DAY_FORMATTER = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' });

function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatHeading(dateStr: string, todayStr: string): string {
  const date = parseLocalDate(dateStr);
  const heading = `${WEEKDAY_FORMATTER.format(date)}, ${MONTH_DAY_FORMATTER.format(date)}`;
  const sameYear = date.getFullYear() === parseLocalDate(todayStr).getFullYear();
  return sameYear ? heading : `${heading}, ${date.getFullYear()}`;
}

function isWeekend(dateStr: string): boolean {
  const day = parseLocalDate(dateStr).getDay();
  return day === 0 || day === 6;
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
          const isToday = group.date === today;
          const dayClasses = ['section', 'calendar-day'];
          if (isWeekend(group.date)) dayClasses.push('weekend');
          if (isToday) dayClasses.push('today');

          return (
            <section key={group.date} className={dayClasses.join(' ')}>
              <h2 className={isOverdue ? 'calendar-day-heading overdue' : 'calendar-day-heading'}>
                {formatHeading(group.date, today)}
                {isToday && <span className="badge today-badge">Today</span>}
                {isOverdue && <span className="badge overdue-badge">Overdue</span>}
              </h2>
              <ul className="task-list">
                {group.tasks.map((task) => (
                  <li key={task.id}>
                    <TaskRow task={task} compact minimalActions showTimeInsteadOfDate />
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
