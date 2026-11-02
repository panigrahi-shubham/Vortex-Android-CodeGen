import type { IncomingMessage } from 'node:http';
/** Returns an error message when the request must be blocked, or null when it is allowed. */
export function checkLocalRequest(req: IncomingMessage, port: number): string | null;
