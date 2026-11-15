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

export interface PgPoolOptions {
  /** off: plain TCP / require: TLS without CA verification / verify: TLS with system CAs. */
  ssl?: 'off' | 'require' | 'verify';
  max?: number;
}

/** node-postgres pool (production, Supabase, Amazon RDS). */
export function createPgPool(connectionString: string, opts: PgPoolOptions = {}): SqlPool {
  const ssl = opts.ssl ?? (/supabase\.(co|com)/.test(connectionString) ? 'require' : 'off');
  const pool = new pg.Pool({
    connectionString,
    max: opts.max ?? 10,
    ssl: ssl === 'off' ? undefined : { rejectUnauthorized: ssl === 'verify' },
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
