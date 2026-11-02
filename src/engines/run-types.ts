export type RunStatus = 'starting' | 'running' | 'passed' | 'skipped' | 'failed' | 'error' | 'no-tests' | 'cancelled' | 'timeout';

export class RunError extends Error {
  code: string;
  httpStatus: number;
  details: Record<string, unknown>;
  constructor(code: string, httpStatus: number, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
  }
}
