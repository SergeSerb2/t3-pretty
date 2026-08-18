const THREAD_ALREADY_EXISTS_PREFIX = "Orchestration command invariant failed (thread.create):";
const THREAD_ALREADY_EXISTS_DETAIL = "already exists and cannot be created twice";

export function isThreadAlreadyExistsErrorMessage(message: string | null | undefined): boolean {
  if (typeof message !== "string") {
    return false;
  }
  return (
    message.includes(THREAD_ALREADY_EXISTS_PREFIX) && message.includes(THREAD_ALREADY_EXISTS_DETAIL)
  );
}

export function isThreadAlreadyExistsError(error: unknown): boolean {
  if (typeof error === "string") {
    return isThreadAlreadyExistsErrorMessage(error);
  }
  if (error instanceof Error) {
    return isThreadAlreadyExistsErrorMessage(error.message);
  }
  if (error !== null && typeof error === "object" && "message" in error) {
    const message = error.message;
    return typeof message === "string" && isThreadAlreadyExistsErrorMessage(message);
  }
  return false;
}
