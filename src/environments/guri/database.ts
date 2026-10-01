import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';

export function fixtureControlUrl(value: string) {
  const url = new URL(value);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    url.pathname !== '/royal_lab_control' ||
    url.search ||
    url.hash
  )
    throw new Error('DATABASE_DENIED: explicit local synthetic control database required');
  return url;
}
export class DisposableDatabase {
  readonly name = `royal_lab_run_${randomUUID().replace(/-/g, '')}`;
  readonly writer: Pool;
  readonly verifier: Pool;
  private constructor(
    private admin: Pool,
    readonly url: string,
  ) {
    this.writer = new Pool({
      connectionString: url,
      max: 2,
      application_name: 'royal-lab-command',
    });
    this.verifier = new Pool({
      connectionString: url,
      max: 1,
      application_name: 'royal-lab-independent-verifier',
    });
  }
  static async create(controlUrl: string, schemaSql: string) {
    const parsed = fixtureControlUrl(controlUrl);
    const admin = new Pool({ connectionString: parsed.toString(), max: 1 });
    const instance = new DisposableDatabase(admin, parsed.toString());
    try {
      const marker = await admin.query(
        "SELECT value FROM royal_lab_control_metadata WHERE key = 'purpose'",
      );
      if (marker.rows[0]?.value !== 'royal-lab-synthetic-only-v1')
        throw new Error('DATABASE_DENIED: missing synthetic control marker');
      await admin.query(`CREATE DATABASE "${instance.name}"`);
      parsed.pathname = `/${instance.name}`;
      // Rebuild handles after creating this unique run's database.
      await instance.writer.end();
      await instance.verifier.end();
      const database = new DisposableDatabase(admin, parsed.toString());
      Object.defineProperty(database, 'name', { value: instance.name });
      try {
        await database.writer.query(schemaSql);
        await database.writer.query(
          'CREATE TABLE "RoyalLabFixtureMetadata" ("purpose" text NOT NULL)',
        );
        await database.writer.query('INSERT INTO "RoyalLabFixtureMetadata" VALUES ($1)', [
          'royal-lab-synthetic-only-v1',
        ]);
        await database.writer.query(
          'CREATE TABLE "RoyalLabOperation" ("key" text PRIMARY KEY, "binding" text NOT NULL, "status" text NOT NULL, "result" jsonb)',
        );
        return database;
      } catch (error) {
        await database.dispose();
        throw error;
      }
    } catch (error) {
      await instance.writer.end().catch(() => {});
      await instance.verifier.end().catch(() => {});
      await admin.end().catch(() => {});
      throw error;
    }
  }
  async seed() {
    await this.writer.query(
      'INSERT INTO "User" ("id","name","email","phone","role","clerkId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [
        'builder-owner',
        'Fictional Builder Reviewer',
        'reviewer@builder.example',
        'fictional-phone',
        'ADMIN',
        'synthetic-clerk',
        '2026-10-04T00:00:00Z',
      ],
    );
    for (const [id, name] of [
      [101, 'Amelia Fiction'],
      [102, 'Amelia Fictional'],
    ] as const)
      await this.writer.query(
        'INSERT INTO "Lead" ("id","name","type","stage","assignedId","updatedAt") VALUES ($1,$2,$3,$4,$5,$6)',
        [id, name, [], 'QUALIFIED', 'builder-owner', '2026-10-04T00:00:00Z'],
      );
  }
  async snapshot() {
    const marker = await this.verifier.query('SELECT * FROM "RoyalLabFixtureMetadata"');
    if (marker.rows[0]?.purpose !== 'royal-lab-synthetic-only-v1')
      throw new Error('DATABASE_DENIED: run fixture marker missing');
    const [leads, tasks, history, operations] = await Promise.all([
      this.verifier.query('SELECT "id","name","stage","assignedId" FROM "Lead" ORDER BY "id"'),
      this.verifier.query('SELECT * FROM "LeadTask" ORDER BY "id"'),
      this.verifier.query('SELECT * FROM "LeadHistory" ORDER BY "id"'),
      this.verifier.query('SELECT * FROM "RoyalLabOperation" ORDER BY "key"'),
    ]);
    return {
      source: 'independent-postgresql-connection' as const,
      database: this.name,
      leads: leads.rows,
      tasks: tasks.rows,
      history: history.rows,
      operations: operations.rows,
    };
  }
  async dispose() {
    await this.writer.end();
    await this.verifier.end();
    if (!/^royal_lab_run_[a-f0-9]{32}$/.test(this.name))
      throw new Error('DATABASE_DENIED: invalid cleanup target');
    try {
      await this.admin.query(`DROP DATABASE "${this.name}" WITH (FORCE)`);
    } finally {
      await this.admin.end();
    }
  }
}
