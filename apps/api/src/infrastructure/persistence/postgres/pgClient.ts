import pg from 'pg';

/** The minimal SQL surface the Postgres adapter needs. Any driver can implement it. */
export interface SqlClient {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  /** Runs a multi-statement script without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface SqlConnection extends SqlClient {
  release(): void;
}

export interface SqlPool {
  connect(): Promise<SqlConnection>;
  end(): Promise<void>;
}

/** node-postgres pool (production, Supabase). */
export function createPgPool(connectionString: string): SqlPool {
  const pool = new pg.Pool({
    connectionString,
    max: 10,
    ssl: /sslmode=require|supabase\.(co|com)/.test(connectionString) ? { rejectUnauthorized: false } : undefined,
  });
  return {
    async connect() {
      const client = await pool.connect();
      return {
        async query(text, params) {
          const r = await client.query(text, params as unknown[]);
          return { rows: r.rows, rowCount: r.rowCount ?? 0 };
        },
        async exec(sql) {
          await client.query(sql);
        },
        release: () => client.release(),
      };
    },
    end: () => pool.end(),
  };
}
