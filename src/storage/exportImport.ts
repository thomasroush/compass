import { AppData, Task, TASK_STATUSES, todayDateString } from '../types';

export function exportToJson(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function exportJsonBackup(data: AppData): void {
  const date = todayDateString();
  const json = exportToJson(data);
  downloadFile(`daily-compass-backup-${date}.json`, json, 'application/json');
}

function formatTaskLine(task: Task): string {
  const parts = [`- [ ] ${task.title}`];
  if (task.priority !== 'Normal') parts.push(`(${task.priority})`);
  if (task.dueDate) parts.push(`due ${task.dueDate}`);
  if (task.notes) parts.push(`— ${task.notes}`);
  return parts.join(' ');
}

export function exportActiveTasksMarkdown(data: AppData): string {
  const active = data.tasks.filter((t) => !t.archived && t.status !== 'Done');
  const lines: string[] = ['# Daily Compass Tasks', ''];

  for (const status of TASK_STATUSES) {
    if (status === 'Done') continue;
    const group = active.filter((t) => t.status === status);
    if (group.length === 0) continue;
    lines.push(`## ${status}`, '');
    for (const task of group.sort((a, b) => a.sortOrder - b.sortOrder)) {
      lines.push(formatTaskLine(task));
    }
    lines.push('');
  }

  return lines.join('\n').trim() + '\n';
}

export function exportMarkdownFile(data: AppData): void {
  const date = todayDateString();
  const md = exportActiveTasksMarkdown(data);
  downloadFile(`daily-compass-tasks-${date}.md`, md, 'text/markdown');
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsText(file);
  });
}
