import { validatePlatformExport } from "@/lib/platforms/validation";
import type { PlatformValidationInput } from "@/lib/platforms/types";

export function validateCompletedPlatformExport(
  input: PlatformValidationInput
): string[] {
  return validatePlatformExport(input);
}
