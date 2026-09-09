import {
  formatTargetValue,
  getGoalProgress,
  getGoalTargets,
  getProjectGoals,
  getProjectTasks,
  getTargetProgress,
  getTasksByStatus,
  sortProjectsByPriority,
} from '../store/reducer';
import type { Goal, Priority, Project, Target, Task } from '../types';

export type CopyToAIScope =
  | { type: 'current-work' }
  | { type: 'today' }
  | { type: 'project'; projectId: string };

const SNAPSHOT_TITLE = '# Daily Compass Snapshot';

const AI_INSTRUCTIONS =
  'Review this workload. Identify priority conflicts, overdue work, vague tasks, missing ' +
  'next actions, and the three most important things I should do next. Do not assume you ' +
  'can change Compass. Present proposed changes for my review.';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/**
 * Deliberately hand-rolled rather than `toLocaleString` — the snapshot must
 * render identical text for identical input regardless of the host
 * machine's locale/ICU configuration (tests run in CI as well as locally).
 */
export function formatGeneratedAt(date: Date): string {
  const month = MONTH_NAMES[date.getMonth()];
  const day = date.getDate();
  const year = date.getFullYear();
  const hours24 = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 || 12;
  return `${month} ${day}, ${year}, ${hours12}:${minutes} ${period}`;
}

function formatDueDate(dueDate?: string): string {
  return dueDate ? `Due: ${dueDate}` : 'No due date';
}

function formatTaskLine(task: Task, projectName?: string | null): string {
  const parts = [`- [ ] ${task.title}`];
  if (projectName !== undefined) {
    parts.push(`Project: ${projectName ?? 'None'}`);
  }
  parts.push(task.priority, formatDueDate(task.dueDate), `Status: ${task.status}`);
  return parts.join(' | ');
}

function describeScope(scope: CopyToAIScope, projects: Project[]): string {
  switch (scope.type) {
    case 'current-work':
      return 'Current work';
    case 'today':
      return 'Today';
    case 'project': {
      const project = projects.find((p) => p.id === scope.projectId);
      return project ? `One project (${project.name})` : 'One project';
    }
  }
}

function projectPriorityLine(project: Project): string {
  const rank = project.priorityRank !== undefined ? String(project.priorityRank) : 'Not ranked';
  return `Project priority: ${rank}`;
}

function pushProjectSection(lines: string[], project: Project, tasksForProject: Task[]): void {
  lines.push(`## Project: ${project.name}`, '', projectPriorityLine(project), '');
  if (tasksForProject.length === 0) {
    lines.push('No tasks in this project.');
  } else {
    for (const task of tasksForProject) lines.push(formatTaskLine(task));
  }
  lines.push('');
}

const PRIORITY_ORDER: Record<Priority, number> = { High: 0, Normal: 1, Low: 2 };

/**
 * One line per Target — reuses getTargetProgress (never re-derives progress
 * here) and, for numeric Targets, formatTargetValue (both from
 * src/store/reducer.ts) so display/calculation logic is never duplicated
 * between the Goals UI and this formatter. Linked-tasks Targets show only
 * the completed/total count, per the plan's "enough to explain the
 * progress" requirement — never every linked task's title.
 */
function formatTargetLine(target: Target, tasks: Task[]): string {
  const progress = Math.round(getTargetProgress(target, tasks));
  if (target.type === 'numeric') {
    const current = formatTargetValue(target.currentValue, target);
    const goalValue = formatTargetValue(target.targetValue, target);
    return `- Target: ${target.name} (numeric): ${current} / ${goalValue} (${progress}%)`;
  }
  if (target.type === 'yesno') {
    return `- Target: ${target.name} (yes/no): ${target.achieved ? 'Yes' : 'Not yet'} (${progress}%)`;
  }
  const completed = target.taskIds.filter((id) => tasks.find((t) => t.id === id)?.status === 'Done').length;
  return `- Target: ${target.name} (linked tasks): ${completed}/${target.taskIds.length} complete (${progress}%)`;
}

/**
 * One Goal's section — active (non-archived) Targets only (getGoalTargets
 * already excludes archived), via formatTargetLine above. `includeLinkedProjects`
 * is false for the One Project scope, where the goal is already shown inside
 * that project's own section — restating "Linked projects: <this project>"
 * there would be redundant.
 */
function pushGoalSection(
  lines: string[],
  goal: Goal,
  targets: Target[],
  tasks: Task[],
  projects: Project[],
  includeLinkedProjects: boolean,
): void {
  const activeTargets = getGoalTargets(targets, goal.id);
  const progress = getGoalProgress(goal, targets, tasks);
  const progressLabel = progress === null ? 'No targets yet' : `${Math.round(progress)}%`;

  lines.push(
    `## Goal: ${goal.name}`,
    '',
    `Priority: ${goal.priority} | ${formatDueDate(goal.dueDate)} | Progress: ${progressLabel}`,
    '',
  );
  if (activeTargets.length === 0) {
    lines.push('No targets yet.');
  } else {
    for (const target of activeTargets) lines.push(formatTargetLine(target, tasks));
  }
  if (includeLinkedProjects) {
    const linkedNames = projects.filter((p) => goal.projectIds.includes(p.id)).map((p) => p.name);
    if (linkedNames.length > 0) {
      lines.push('', `Linked projects: ${linkedNames.join(', ')}`);
    }
  }
  lines.push('');
}

/**
 * Pushes one section per Active Goal (Paused/Achieved/Abandoned never
 * appear in a working snapshot), sorted by priority then name — mirroring
 * sortProjectsByPriority's own tie-break convention. Returns whether any
 * Goal content was pushed, so callers can fold it into their own
 * has-any-content check.
 */
function pushActiveGoalSections(
  lines: string[],
  goals: Goal[],
  targets: Target[],
  tasks: Task[],
  projects: Project[],
  includeLinkedProjects: boolean,
): boolean {
  const activeGoals = [...goals]
    .filter((g) => g.status === 'active')
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.name.localeCompare(b.name));

  for (const goal of activeGoals) {
    pushGoalSection(lines, goal, targets, tasks, projects, includeLinkedProjects);
  }
  return activeGoals.length > 0;
}

function buildCurrentWorkBody(
  lines: string[],
  projects: Project[],
  tasks: Task[],
  goals: Goal[],
  targets: Target[],
): void {
  const activeProjects = sortProjectsByPriority(projects.filter((p) => p.status === 'active'));
  let hasContent = false;

  for (const project of activeProjects) {
    const projectTasks = tasks
      .filter((t) => t.projectId === project.id && !t.archived && t.status !== 'Done')
      .sort((a, b) => a.sortOrder - b.sortOrder);
    if (projectTasks.length === 0) continue;
    pushProjectSection(lines, project, projectTasks);
    hasContent = true;
  }

  const unassigned = tasks
    .filter((t) => !t.projectId && !t.archived && t.status !== 'Done')
    .sort((a, b) => a.sortOrder - b.sortOrder);

  if (unassigned.length > 0) {
    lines.push('## Unassigned tasks', '');
    for (const task of unassigned) lines.push(formatTaskLine(task));
    lines.push('');
    hasContent = true;
  }

  if (pushActiveGoalSections(lines, goals, targets, tasks, projects, true)) {
    hasContent = true;
  }

  if (!hasContent) {
    lines.push('No active tasks, projects, or goals match this scope.', '');
  }
}

function buildTodayBody(lines: string[], projects: Project[], tasks: Task[]): void {
  const todayTasks = getTasksByStatus(tasks, 'Today');
  lines.push("## Today's tasks", '');
  if (todayTasks.length === 0) {
    lines.push('No tasks are scheduled for Today.', '');
    return;
  }
  for (const task of todayTasks) {
    const project = task.projectId ? projects.find((p) => p.id === task.projectId) : undefined;
    lines.push(formatTaskLine(task, project?.name ?? null));
  }
  lines.push('');
}

function buildProjectBody(
  lines: string[],
  projects: Project[],
  tasks: Task[],
  goals: Goal[],
  targets: Target[],
  projectId: string,
): void {
  // Mirrors the plan's "select one active project": a project that is
  // archived, completed, or no longer exists is treated the same as no
  // selection, so an archived project can never be revealed through this
  // scope even if a stale id somehow reaches the formatter.
  const project = projects.find((p) => p.id === projectId && p.status === 'active');
  if (!project) {
    lines.push('No project selected.', '');
    return;
  }
  const projectTasks = getProjectTasks(tasks, project.id);
  pushProjectSection(lines, project, projectTasks);

  // Already inside this project's own section, so the "Linked projects:"
  // line inside pushGoalSection would be redundant — omitted here.
  const linkedGoals = getProjectGoals(goals, project.id);
  pushActiveGoalSections(lines, linkedGoals, targets, tasks, projects, false);
}

/**
 * Pure, deterministic snapshot formatter for the "Copy to AI" feature.
 * Given the same projects/tasks/goals/targets/scope/generatedAt, always
 * produces the same string. Never includes IDs, timestamps used only for
 * sync, or any field beyond what the current Compass data model already
 * displays. Today's scope is deliberately never given goals/targets —
 * buildTodayBody's signature and behavior are unchanged.
 */
export function buildAISnapshot(
  projects: Project[],
  tasks: Task[],
  goals: Goal[],
  targets: Target[],
  scope: CopyToAIScope,
  generatedAt: Date,
): string {
  const lines: string[] = [
    SNAPSHOT_TITLE,
    '',
    `Generated: ${formatGeneratedAt(generatedAt)}`,
    `Scope: ${describeScope(scope, projects)}`,
    '',
    '## Instructions for my AI',
    '',
    AI_INSTRUCTIONS,
    '',
  ];

  if (scope.type === 'today') {
    buildTodayBody(lines, projects, tasks);
  } else if (scope.type === 'project') {
    buildProjectBody(lines, projects, tasks, goals, targets, scope.projectId);
  } else {
    buildCurrentWorkBody(lines, projects, tasks, goals, targets);
  }

  return lines.join('\n').trim() + '\n';
}
