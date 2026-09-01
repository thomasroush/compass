import { describe, expect, it } from 'vitest';
import { vi } from 'vitest';

vi.mock('../lib/supabaseClient', () => ({
  supabase: null,
  isSupabaseConfigured: false,
}));

import { getAuthenticatedSessionFor } from './session';

describe('getAuthenticatedSessionFor when Supabase is not configured', () => {
  it('returns a typed unconfigured error without attempting a network call', async () => {
    const result = await getAuthenticatedSessionFor('user-1');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.type).toBe('unconfigured');
      expect(result.error.message).toMatch(/not connected to Supabase/i);
    }
  });
});
