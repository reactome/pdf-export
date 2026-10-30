// The graph's connection (spec 001 T013, research R2): the Neo4j driver, with the
// database name and credentials from settings, never from the command line.
import neo4j, { type Driver } from 'neo4j-driver';

export interface GraphSettings {
  uri: string;
  user: string;
  password: string;
  /** Reactome's graph database is named graph.db. */
  database: string;
}

/** The settings from NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD and NEO4J_DATABASE. */
export function graphSettings(env: Readonly<Record<string, string | undefined>>): GraphSettings {
  const uri = env['NEO4J_URI'];
  if (!uri) throw new Error('NEO4J_URI is not set: the address of the release graph');
  return {
    uri,
    user: env['NEO4J_USER'] ?? 'neo4j',
    password: env['NEO4J_PASSWORD'] ?? '',
    database: env['NEO4J_DATABASE'] ?? 'graph.db',
  };
}

/** A read-only view of the graph: one query, its rows as plain objects. */
export interface Graph {
  read<T>(query: string, params?: Record<string, unknown>): Promise<T[]>;
  close(): Promise<void>;
}

export function openGraph(settings: GraphSettings): Graph {
  // Integers as JavaScript numbers: Reactome's ids are well below 2^53.
  const driver: Driver = neo4j.driver(
    settings.uri,
    neo4j.auth.basic(settings.user, settings.password),
    { disableLosslessIntegers: true }
  );
  return {
    async read<T>(query: string, params: Record<string, unknown> = {}): Promise<T[]> {
      const session = driver.session({
        database: settings.database,
        defaultAccessMode: neo4j.session.READ,
      });
      try {
        const result = await session.executeRead((tx) => tx.run(query, params));
        return result.records.map((record) => record.toObject() as T);
      } finally {
        await session.close();
      }
    },
    close: () => driver.close(),
  };
}
