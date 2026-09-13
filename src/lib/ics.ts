import { downloadFile } from '../storage/exportImport';
import { addDaysToDate, type Task } from '../types';

const CRLF = '\r\n';

/**
 * RFC 5545 TEXT escaping. Backslash must be escaped first — escaping it after
 * the other characters would double-escape the backslashes those steps just
 * introduced.
 */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function formatIcsDate(dateStr: string): string {
  return dateStr.replace(/-/g, '');
}

/** Floating local time (no trailing Z, no TZID) per the "no timezone conversion" requirement. */
function formatIcsDateTime(dateStr: string, timeStr: string): string {
  const [hh, mm] = timeStr.split(':');
  return `${formatIcsDate(dateStr)}T${hh.padStart(2, '0')}${mm.padStart(2, '0')}00`;
}

function formatIcsTimestampUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** One hour after `dateStr`/`timeStr`, rolling over to the next day if needed. */
function addOneHour(dateStr: string, timeStr: string): string {
  const [hh, mm] = timeStr.split(':').map(Number);
  const totalMinutes = hh * 60 + mm + 60;
  const dayOverflow = Math.floor(totalMinutes / (24 * 60));
  const minutesOfDay = totalMinutes % (24 * 60);
  const endDate = dayOverflow > 0 ? addDaysToDate(dateStr, dayOverflow) : dateStr;
  const endTime = `${String(Math.floor(minutesOfDay / 60)).padStart(2, '0')}:${String(minutesOfDay % 60).padStart(2, '0')}`;
  return formatIcsDateTime(endDate, endTime);
}

export interface IcsTaskContext {
  projectName?: string;
}

/** Returns a full .ics file body, or null if the task has no due date to export. */
export function buildTaskIcs(task: Task, context: IcsTaskContext = {}): string | null {
  if (!task.dueDate) return null;

  const timeLines = task.dueTime
    ? [
        `DTSTART:${formatIcsDateTime(task.dueDate, task.dueTime)}`,
        `DTEND:${addOneHour(task.dueDate, task.dueTime)}`,
      ]
    : [
        `DTSTART;VALUE=DATE:${formatIcsDate(task.dueDate)}`,
        `DTEND;VALUE=DATE:${formatIcsDate(addDaysToDate(task.dueDate, 1))}`,
      ];

  const descriptionParts: string[] = [];
  if (context.projectName) descriptionParts.push(`Project: ${context.projectName}`);
  descriptionParts.push(`Priority: ${task.priority}`);
  descriptionParts.push(`Status: ${task.status}`);
  if (task.notes) descriptionParts.push(`Notes: ${task.notes}`);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Daily Compass//Task Calendar Export//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${task.id}@daily-compass`,
    `DTSTAMP:${formatIcsTimestampUtc(new Date())}`,
    ...timeLines,
    `SUMMARY:${escapeIcsText(task.title)}`,
    `DESCRIPTION:${escapeIcsText(descriptionParts.join('\n'))}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ];

  return lines.join(CRLF);
}

function sanitizeFilename(title: string): string {
  const cleaned = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'task';
}

export function taskIcsFilename(task: Task): string {
  return `${sanitizeFilename(task.title)}.ics`;
}

export function downloadTaskIcs(task: Task, context: IcsTaskContext = {}): void {
  const ics = buildTaskIcs(task, context);
  if (!ics) return;
  downloadFile(taskIcsFilename(task), ics, 'text/calendar');
}
