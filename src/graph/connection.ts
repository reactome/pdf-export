// The graph's connection (spec 001 T013, research R2): the Neo4j driver, with the
// database name and credentials from settings, never from the command line.
import neo4j, { type Driver } from 'neo4j-driver';

import type { Row } from './rows.ts';

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

/**
 * A read-only view of the graph: one query, its rows as plain objects, their values
 * unchecked (each query checks its own, src/graph/rows.ts).
 */
export interface Graph {
  read(query: string, params?: Record<string, unknown>, options?: ReadOptions): Promise<Row[]>;
  close(): Promise<void>;
}

export interface ReadOptions {
  /** How long this read may run in the database, in place of the graph's own timeout. */
  timeoutMs?: number;
}

export interface GraphOptions {
  /**
   * How long one read may run in the database before Neo4j ends it (the driver's transaction
   * timeout); none without it.
   */
  transactionTimeoutMs?: number;
  /**
   * How long the driver waits to open a connection, and for one from its pool. The driver
   * offers no bound on a read from an open connection (only the server's own receive-timeout
   * hint): a caller that must not wait on a silent one bounds its own wait.
   */
  connectionTimeoutMs?: number;
  /**
   * How long the driver goes on retrying a read that failed for want of a connection, from
   * its first failure (the driver's `maxTransactionRetryTime`); the driver's own default
   * (30 s) without it. Even 0 makes one retry: it bounds the retrying, it does not end it.
   */
  retryTimeMs?: number;
}

export function openGraph(settings: GraphSettings, options: GraphOptions = {}): Graph {
  // Integers as JavaScript numbers: Reactome's ids are well below 2^53.
  const driver: Driver = neo4j.driver(
    settings.uri,
    neo4j.auth.basic(settings.user, settings.password),
    {
      disableLosslessIntegers: true,
      ...(options.connectionTimeoutMs === undefined
        ? {}
        : {
            connectionTimeout: options.connectionTimeoutMs,
            connectionAcquisitionTimeout: options.connectionTimeoutMs,
          }),
      ...(options.retryTimeMs === undefined
        ? {}
        : { maxTransactionRetryTime: options.retryTimeMs }),
    }
  );
  return {
    async read(
      query: string,
      params: Record<string, unknown> = {},
      { timeoutMs = options.transactionTimeoutMs }: ReadOptions = {}
    ): Promise<Row[]> {
      // the driver's transaction timeout: Neo4j ends the read there, whoever still waits
      const config = timeoutMs === undefined ? {} : { timeout: Math.max(1, Math.ceil(timeoutMs)) };
      const session = driver.session({
        database: settings.database,
        defaultAccessMode: neo4j.session.READ,
      });
      try {
        const result = await session.executeRead((tx) => tx.run(query, params), config);
        return result.records.map((record): Row => record.toObject());
      } finally {
        await session.close();
      }
    },
    close: () => driver.close(),
  };
}
