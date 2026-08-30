import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabaseClient', () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));

import { listProjects } from './projectsRepository';
import { listTasks } from './tasksRepository';
import { listDailyNotes } from './dailyNotesRepository';

describe('repositories when Supabase is not configured', () => {
  it('every list function returns a typed unconfigured error instead of throwing or hitting the network', async () => {
    for (const list of [listProjects, listTasks, listDailyNotes]) {
      const result = await list();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.type).toBe('unconfigured');
        expect(result.error.message).toMatch(/not connected to Supabase/i);
      }
    }
  });
});
