import { TokenCategory } from './types.js';

/**
 * Checks if a string value has a "px" unit.
 * @param value The string value to check (e.g., "16px", "100%").
 * @returns True if the value ends with "px", false otherwise.
 */
export function hasPxUnit(value: string): boolean {
  return typeof value === 'string' && value.endsWith('px');
}

/**
 * Extracts the numeric part of a pixel value string.
 * @param pxValue The pixel value string (e.g., "16px").
 * @returns The numeric value (e.g., 16) or null if extraction fails.
 */
export function extractPxValue(pxValue: string): number | null {
  if (!hasPxUnit(pxValue)) {
    // Allow unitless zero to be processed as a number if it's explicitly "0"
    if (pxValue === '0') return 0;
    return null;
  }
  const numericPart = pxValue.substring(0, pxValue.length - 2);
  const numericValue = parseFloat(numericPart);
  return isNaN(numericValue) ? null : numericValue;
} 