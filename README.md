# Daily Compass

A simple personal task-management website for one user. Runs entirely in the browser with local storage — no account, no backend, no cloud.

## Start

```bash
npm install
npm run dev
```

Open the URL shown in the terminal (typically http://localhost:5173).

### Other commands

```bash
npm run build    # production build
npm run preview  # preview production build
npm run test     # run essential tests
npm run lint     # ESLint
```

## Features

- **Today** — primary tasks (up to 3), other today tasks, overdue tasks
- **Board** — six-column Kanban (Inbox, This Week, Today, In Progress, Waiting, Done)
- **Tasks** — add, edit, search, filter, archive
- **Projects** — group tasks, mark completed or archived
- **Daily Notes** — morning and evening notes by date
- **Settings** — JSON export/import, Markdown export, reset

## Data storage

All data is stored in your browser's **localStorage** under the key `daily-compass-v1`. It persists when you close the tab or browser, but:

- Data is tied to this browser on this device (no sync).
- Clearing site data or uninstalling the browser removes it.

**Back up regularly** using Settings → Export JSON backup.

## Backup and restore

1. **Export** — Settings → Export JSON backup (downloads a `.json` file).
2. **Import** — Settings → choose a backup file → confirm replace.
3. **Reset** — Settings → Reset all data → type `RESET` to confirm.

## Known limitations

- No drag-and-drop on the board (use the status selector or move buttons).
- Archived tasks are hidden from Today and Board by default.
- No multi-device sync.
