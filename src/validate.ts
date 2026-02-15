export class ValidationError extends Error {
  code = "validation_error";
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class EngineError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EngineError";
    this.code = code;
  }
}

export function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required and must be a non-empty string`);
  }
  return value.trim();
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string`);
  }
  return value;
}

export function requireArray<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(`${field} is required and must be a non-empty array`);
  }
  return value as T[];
}

export function optionalArray<T>(value: unknown, field: string): T[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array`);
  }
  return value as T[];
}

export function optionalNumber(value: unknown, field: string, min?: number, max?: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || isNaN(value)) {
    throw new ValidationError(`${field} must be a number`);
  }
  if (min !== undefined && value < min) {
    throw new ValidationError(`${field} must be >= ${min}`);
  }
  if (max !== undefined && value > max) {
    throw new ValidationError(`${field} must be <= ${max}`);
  }
  return value;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") {
    throw new ValidationError(`${field} must be a boolean`);
  }
  return value;
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(`${field} is required and must be an object`);
  }
  return value as Record<string, unknown>;
}
