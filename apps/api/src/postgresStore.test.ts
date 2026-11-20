import { afterEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import type { Lead } from '../../../packages/shared/dist/index.js';
import { runAsDatabaseActor } from './databaseContext.js';
import { checkDatabaseHealth, databaseConfiguration, databaseConfigured, readPostgresStore, setPoolForTests, updatePostgresStore } from './postgresStore.js';

const originalUrl = process.env.DATABASE_URL;

afterEach(() => {
  setPoolForTests(undefined);
  if (originalUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalUrl;
});

describe('PostgreSQL storage configuration', () => {
  it('reports missing database configuration without implying storage is healthy', async () => {
    delete process.env.DATABASE_URL;
    expect(databaseConfigured()).toBe(false);
    expect(databaseConfiguration()).toMatchObject({ configured: false, error: 'PostgreSQL storage is not configured. Set DATABASE_URL on the API server.' });
    await expect(checkDatabaseHealth()).resolves.toMatchObject({
      configured: false,
      connected: false,
      storage: 'postgresql',
      error: 'PostgreSQL storage is not configured. Set DATABASE_URL on the API server.',
    });
  });

  it('accepts a valid PostgreSQL URI without sslmode because the pool enforces verified TLS', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co:5432/postgres';
    expect(databaseConfiguration()).toEqual({ configured: true });
    expect(databaseConfigured()).toBe(true);
  });

  it('rejects connection strings that explicitly disable TLS', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co:5432/postgres?sslmode=disable';
    expect(databaseConfiguration()).toMatchObject({ configured: false, error: 'DATABASE_URL requests a non-TLS connection. PostgreSQL connections must use TLS.' });
  });

  it('reports malformed and placeholder values as invalid instead of missing', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co:5432/postgres?sslmode=require';
    expect(databaseConfiguration()).toEqual({ configured: true });
    process.env.DATABASE_URL = 'not-a-postgres-uri';
    expect(databaseConfiguration()).toMatchObject({ configured: false, error: 'DATABASE_URL is invalid. Use the Supabase Connect PostgreSQL URI.' });
    process.env.DATABASE_URL = 'postgresql://user:pass@db.example.test:5432/postgres';
    expect(databaseConfiguration()).toMatchObject({ configured: false, error: 'Replace the DATABASE_URL placeholder with the PostgreSQL URI from Supabase Connect.' });
  });

  it('requires an authenticated database actor before reading CRM records', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co:5432/postgres?sslmode=require';
    await expect(readPostgresStore()).rejects.toThrow('Database access requires an authenticated CRM user.');
  });

  it('persists lead/company rows inside a transaction scoped to the verified Auth user', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co:5432/postgres?sslmode=require';
    const actorId = '00000000-0000-4000-8000-000000000001';
    const companyId = '00000000-0000-4000-8000-000000000002';
    const tableRows = new Map<string, Record<string, unknown>[]>([['profiles', [{ id: actorId, full_name: 'Asha Nair', role: 'salesperson', active: true }]]]);
    const statements: { sql: string; values?: unknown[] }[] = [];
    const client = {
      async query(sql: string, values: unknown[] = []) {
        statements.push({ sql, values });
        const select = sql.match(/^select \* from public\.(\w+)$/i);
        if (select) return { rows: tableRows.get(select[1]!) || [], rowCount: (tableRows.get(select[1]!) || []).length };
        if (/insert into public\.companies/i.test(sql)) {
          const row = { id: companyId, name: values[0], website: values[1], logo_url: values[2], industry: values[3], net_worth: values[4] };
          tableRows.set('companies', [row]); return { rows: [{ id: companyId }], rowCount: 1 };
        }
        if (/select id from public\.companies where lower\(name\)/i.test(sql)) return { rows: [{ id: companyId }], rowCount: 1 };
        const insert = sql.match(/^insert into public\.(\w+) \(([^)]+)\) values/i);
        if (insert) {
          const table = insert[1]!; const columns = insert[2]!.split(',');
          const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
          const rows = tableRows.get(table) || []; rows.push(row); tableRows.set(table, rows);
          return { rows: [], rowCount: 1 };
        }
        if (/^update public\./i.test(sql)) return { rows: [], rowCount: 1 };
        return { rows: [], rowCount: 0 };
      },
      release() {},
    };
    const fakePool = { connect: async () => client } as unknown as Pool;
    setPoolForTests(fakePool);
    const lead: Lead = {
      id: '00000000-0000-4000-8000-000000000003', name: 'New Lead', company: 'Acme Ltd', role: 'Director', companyLogo: '', companyNetWorth: 0,
      aiOutreachTopic: '', aiOpeningMessage: '', aiEmailSubject: '', aiFollowUpApproach: '', email: 'new@example.com', phone: '', website: 'https://acme.example', linkedin: '', industry: 'Technology', source: 'Website',
      status: 'New Lead', priority: 'Medium', revenue: 1000, currency: 'INR', progression: 5, probability: 10, assignedTo: 'Asha Nair', nextFollowUp: null, expectedClose: null, notes: '',
      createdAt: '2026-11-18T10:00:00.000Z', updatedAt: '2026-11-18T10:00:00.000Z', lastContacted: null, archived: false, stageHistory: [{ status: 'New Lead', at: '2026-11-18T10:00:00.000Z', by: 'Asha Nair' }], changeHistory: [],
    };

    await runAsDatabaseActor({ id: actorId, role: 'salesperson' }, async () => {
      await updatePostgresStore((state) => { state.leads.push(lead); return lead.id; });
      const restored = await readPostgresStore();
      expect(restored.leads[0]).toMatchObject({ id: lead.id, name: 'New Lead', company: 'Acme Ltd', assignedTo: 'Asha Nair' });
    });

    expect(statements.some((x) => x.sql === 'set local role authenticated')).toBe(true);
    expect(statements.some((x) => x.sql.includes('request.jwt.claim.sub') && x.values?.[0] === actorId)).toBe(true);
    expect(statements.some((x) => /insert into public\.leads/i.test(x.sql))).toBe(true);
    expect(tableRows.get('companies')?.[0]?.id).toBe(companyId);
  });

  it('distinguishes rejected database credentials from missing configuration', async () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@db.supabase.co:5432/postgres?sslmode=require';
    const fakePool = { connect: async () => { throw Object.assign(new Error('password authentication failed'), { code: '28P01' }); } } as unknown as Pool;
    setPoolForTests(fakePool);
    await expect(checkDatabaseHealth()).resolves.toMatchObject({
      configured: true,
      connected: false,
      error: 'PostgreSQL rejected the configured username or password. Check DATABASE_URL in the API service settings.',
    });
  });
});
