/**
 * Safely extract a route parameter as a string.
 * Express v5 types allow string | string[] for params.
 */
export function param(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0];
  return value || "";
}
