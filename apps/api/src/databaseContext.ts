import { AsyncLocalStorage } from 'node:async_hooks';

export type DatabaseActor = { id: string; role: 'admin' | 'manager' | 'salesperson' };
const actorStorage = new AsyncLocalStorage<DatabaseActor>();

export function runAsDatabaseActor<T>(actor: DatabaseActor, callback: () => T): T {
  return actorStorage.run(actor, callback);
}

export function currentDatabaseActor(): DatabaseActor | undefined {
  return actorStorage.getStore();
}
