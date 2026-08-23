import type { ValidationErrors } from "../../domain/connection";

export function clearValidationError(
  current: ValidationErrors,
  field: keyof ValidationErrors,
): ValidationErrors {
  if (!current[field]) return current;
  const next = { ...current };
  delete next[field];
  return next;
}
