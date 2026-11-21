import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(new URL('../../../supabase/migrations/202611210002_activity_rls_lead_scope.sql', import.meta.url), 'utf8');
const directRoleMigration = readFileSync(new URL('../../../supabase/migrations/202611210003_activity_rls_lead_scope_direct_role.sql', import.meta.url), 'utf8');
const creatorMigration = readFileSync(new URL('../../../supabase/migrations/202611210004_activity_rls_lead_creator.sql', import.meta.url), 'utf8');

describe('activity lead-scope RLS migration', () => {
  it('uses a hardened boolean helper instead of a nested RLS-filtered lead SELECT', () => {
    expect(migration).toMatch(/security definer\s+set search_path = ''/i);
    expect(migration).toMatch(/select exists \([\s\S]*?from public\.leads as l[\s\S]*?l\.id = p_lead_id/i);
    expect(migration).toMatch(/public\.can_manage_team\(\)\s+or l\.assigned_to = auth\.uid\(\)\s+or l\.is_shared = true/i);
  });

  it('retains creator ownership and grants helper execution only to authenticated users', () => {
    expect(migration).toMatch(/revoke all on function public\.can_access_lead\(uuid\) from public/i);
    expect(migration).toMatch(/grant execute on function public\.can_access_lead\(uuid\) to authenticated/i);
    expect(migration).toMatch(/create policy leads_read_assigned_or_shared on public\.leads for select to authenticated\s+using \(public\.can_access_lead\(id\)\)/i);
    expect(migration).toMatch(/with check \(\s*created_by = auth\.uid\(\)\s+and public\.can_access_lead\(lead_id\)/i);
  });

  it('uses a direct active-profile role check for the follow-up migration', () => {
    expect(directRoleMigration).toMatch(/security definer\s+set search_path = ''/i);
    expect(directRoleMigration).toMatch(/p\.role in \('admin','manager'\)/i);
    expect(directRoleMigration).toMatch(/l\.assigned_to = auth\.uid\(\)\s+or l\.is_shared = true/i);
    expect(directRoleMigration).toMatch(/revoke all on function public\.can_access_lead\(uuid\) from public/i);
  });

  it('allows only the lead creator as an additional own-lead access condition', () => {
    expect(creatorMigration).toMatch(/l\.created_by = auth\.uid\(\)/i);
    expect(creatorMigration).toMatch(/p\.role in \('admin','manager'\)/i);
    expect(creatorMigration).toMatch(/l\.assigned_to = auth\.uid\(\)/i);
    expect(creatorMigration).toMatch(/l\.is_shared = true/i);
  });
});
