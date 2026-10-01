import { DatabaseSync } from 'node:sqlite';
import { stableJson } from '#src/environments/session';
export class OperationJournal {
  private database: DatabaseSync;
  constructor(file: string) {
    this.database = new DatabaseSync(file);
    this.database.exec(
      'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS operations (key TEXT PRIMARY KEY, binding TEXT NOT NULL, status TEXT NOT NULL, result TEXT)',
    );
  }
  async execute(key: string, binding: string, operation: () => Promise<unknown>) {
    const previous = this.database.prepare('SELECT * FROM operations WHERE key=?').get(key);
    if (previous) {
      if (previous.binding !== binding) throw new Error('JOURNAL_BINDING_CONFLICT');
      if (previous.status !== 'committed')
        throw new Error('JOURNAL_UNCERTAIN: independently reconcile before retry');
      return { status: 'replayed', result: JSON.parse(String(previous.result)) };
    }
    this.database
      .prepare('INSERT INTO operations(key,binding,status) VALUES(?,?,?)')
      .run(key, binding, 'pending');
    // SQLite is experiment metadata, not an atomic transaction with remote business state.
    // A crash or unknown acknowledgement leaves pending and MUST NOT execute again.
    const result = await operation();
    const json = stableJson(result);
    this.database
      .prepare('UPDATE operations SET status=?, result=? WHERE key=? AND binding=?')
      .run('committed', json, key, binding);
    return { status: 'committed', result };
  }
  close() {
    this.database.close();
  }
}
