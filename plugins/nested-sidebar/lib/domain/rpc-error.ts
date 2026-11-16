/**
 * The small vocabulary a failed domain action answers with.
 *
 * A message is for the person reading it; a code is for the caller deciding
 * what to do next. Both live on one error so an RPC handler, an agent tool, and
 * a test can branch on the same value instead of matching prose.
 */
export const RPC_ERROR_CODES = [
  "invalid",
  "not-found",
  "blocked",
  "unavailable",
  "conflict",
  "stale",
] as const;

export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

export class RpcError extends Error {
  readonly code: RpcErrorCode;

  constructor(code: RpcErrorCode, message: string) {
    super(message);
    this.name = "RpcError";
    this.code = code;
  }
}

export function isRpcError(error: unknown): error is RpcError {
  return error instanceof RpcError;
}

/** The sentence an agent tool hands back for a failed domain action. */
export function describeActionError(error: unknown): string {
  if (isRpcError(error)) return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
