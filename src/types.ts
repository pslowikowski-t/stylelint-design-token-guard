/**
 * Represents a category of design tokens, such as spacing, sizing, or radius.
 */
export interface TokenCategory {
  /**
   * A list of CSS properties (lowercase) that this token category applies to.
   * For example, ["margin", "padding", "gap"] for spacing tokens.
   */
  properties: string[];

  /**
   * A mapping of pixel/raw values (as string keys, e.g., "16px", "0")
   * to their corresponding CSS token variable names (e.g., "var(--spacing-4)").
   */
  tokens: Record<string, string>;
} 

/**
 * Options for the text-app-token-guard rule.
 */
export interface RuleOptions {
  /**
   * The margin for token match tolerance.
   * @default 2
   */
  tokenMatchMargin?: number;

  /**
   * Path to the JSON file containing token definitions.
   * This path should be relative to the project root or an absolute path.
   */
  tokensFilePath: string;
}