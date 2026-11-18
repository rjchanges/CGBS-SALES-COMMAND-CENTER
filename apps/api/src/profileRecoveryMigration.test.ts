import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../../supabase/migrations/202611200001_profile_recovery.sql', import.meta.url), 'utf8');

describe('profile recovery migration contract', () => {
  it('creates new profiles from Auth users with only the salesperson role and no overwrite', () => {
    expect(migration).toMatch(/after insert on auth\.users/i);
    expect(migration).toMatch(/'salesperson'::public\.user_role/i);
    expect(migration.match(/on conflict \(id\) do nothing/gi)).toHaveLength(3);
    expect(migration).toMatch(/from auth\.users as u/i);
  });

  it('limits recovery to auth.uid() and grants the function only to authenticated users', () => {
    expect(migration).toMatch(/if auth\.uid\(\) is null/i);
    expect(migration).toMatch(/where auth\.users\.id = auth\.uid\(\)/i);
    expect(migration).toMatch(/revoke all on function public\.ensure_own_profile\(\) from public, anon/i);
    expect(migration).toMatch(/grant execute on function public\.ensure_own_profile\(\) to authenticated/i);
  });

  it('allows self profile reads while restricting profile updates to admins', () => {
    expect(migration).toMatch(/for select to authenticated\s+using \(id = \(select auth\.uid\(\)\)\)/i);
    expect(migration).toMatch(/as restrictive for update to authenticated[\s\S]*?using \(public\.current_role\(\) = 'admin'::public\.user_role\)[\s\S]*?with check \(public\.current_role\(\) = 'admin'::public\.user_role\)/i);
  });
});
