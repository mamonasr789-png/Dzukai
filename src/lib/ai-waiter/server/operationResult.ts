import type { ToolErrorCode } from "../schemas.ts";

export type SafeOperationResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      error: {
        code: ToolErrorCode;
        message: string;
      };
    };

export function operationError(
  code: ToolErrorCode,
  message: string
): SafeOperationResult<never> {
  return { ok: false, error: { code, message } };
}
