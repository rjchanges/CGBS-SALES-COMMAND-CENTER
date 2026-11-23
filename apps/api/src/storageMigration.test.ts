import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../../../supabase/migrations/202611210001_storage_adapter.sql', import.meta.url), 'utf8');

describe('storage migration contract', () => {
  it('adds the persistence fields and tables consumed by the CRM adapter', () => {
    for (const name of ['alternative_contact_method', 'client_mutation_id', 'schedule_history', 'source_type', 'daily_call_target']) expect(sql).toContain(name);
    for (const table of ['calling_profiles', 'voice_calls', 'reminders']) expect(sql).toMatch(new RegExp(`create table if not exists public\\.${table}`, 'i'));
  });

  it('enables RLS and restricts personal calling data and reminders to owners or authorized managers', () => {
    expect(sql).toMatch(/alter table public\.calling_profiles enable row level security/i);
    expect(sql).toMatch(/user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/alter table public\.voice_calls enable row level security/i);
    expect(sql).toMatch(/alter table public\.reminders enable row level security/i);
    expect(sql).toMatch(/owner_id = auth\.uid\(\) or public\.can_manage_team\(\)/i);
  });
});
