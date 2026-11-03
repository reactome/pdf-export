// Why an analysis cannot be read (contracts/service.md): the service's 404 or a token it
// could not hold is `unknown-token`, its 410 `gone-token`, and any other failure
// `unavailable` (research R6).

export type AnalysisFailure = 'unknown-token' | 'gone-token' | 'unavailable';

export class AnalysisError extends Error {
  readonly reason: AnalysisFailure;
  constructor(reason: AnalysisFailure, message: string) {
    super(message);
    this.name = 'AnalysisError';
    this.reason = reason;
  }
}
