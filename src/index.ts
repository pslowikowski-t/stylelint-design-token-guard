import stylelint, { type Rule, type PostcssResult, type RuleMessages, type Problem, type RuleContext, type RuleMeta } from 'stylelint';
import type { Declaration, Root as PostcssRoot } from 'postcss';
import valueParser, { type Node as ValueNode } from 'postcss-value-parser';
import fs from 'fs';
import path from 'path';
import { TokenCategory, RuleOptions } from './types.js';
import { hasPxUnit, extractPxValue } from './helpers.js';

export const ruleName = 'design-token-guard/enforce-tokens';
const DEFAULT_TOKEN_MATCH_MARGIN = 2;

export const messages: RuleMessages = stylelint.utils.ruleMessages(ruleName, {
  exactMatch: (tokenName: string, originalValue: string, propertyName: string): string =>
    `Design token ${tokenName} expected for property ${propertyName}: ${originalValue}`,
  closeMatch: (tokenName: string, tokenPxValue: string, originalValue: string, otherSuggestions: string): string =>
    `Consider token: ${tokenName} ('${tokenPxValue}') for current value "${originalValue}".` +
    (otherSuggestions ? ` Other close matches: ${otherSuggestions}.` : ''),
});

// This is the actual rule implementation
const ruleImpl = (primaryOption: boolean, secondaryOptionsObject: RuleOptions | undefined, context: RuleContext) => {
  return (root: PostcssRoot, result: PostcssResult) => {
    const validOptions = stylelint.utils.validateOptions(
      result,
      ruleName,
      { actual: primaryOption },
      {
        actual: secondaryOptionsObject,
        possible: {
          tokenMatchMargin: [(val: unknown): val is number => typeof val === 'number' && val >= 0],
          tokensFilePath: [(val: unknown): val is string => typeof val === 'string' && val.length > 0],
        },
        optional: false,
      }
    );

    if (!validOptions || !primaryOption || !secondaryOptionsObject) {
      return;
    }

    // Determine the tokenMatchMargin to use
    const options = secondaryOptionsObject;
    const tokenMatchMargin = (typeof options.tokenMatchMargin === 'number')
      ? options.tokenMatchMargin
      : DEFAULT_TOKEN_MATCH_MARGIN;

    let activeCategories: Record<string, TokenCategory> = {};
    try {
      const resolvedPath = path.resolve(secondaryOptionsObject.tokensFilePath);
      if (!fs.existsSync(resolvedPath)) {
        result.warn(`Custom tokens file not found at: ${resolvedPath}`, { node: root, stylelintType: 'parseError' });
        return;
      }
      const fileContents = fs.readFileSync(resolvedPath, 'utf-8');
      activeCategories = JSON.parse(fileContents) as Record<string, TokenCategory>;
      // Basic validation of the loaded structure (can be expanded)
      if (typeof activeCategories !== 'object' || activeCategories === null) throw new Error('Tokens file must be a JSON object.');
      for (const key in activeCategories) {
        if (typeof activeCategories[key].properties === 'undefined' || typeof activeCategories[key].tokens === 'undefined') {
          throw new Error(`Token category '${key}' is missing 'properties' or 'tokens' field.`);
        }
      }
    } catch (e: any) { // Explicitly type 'e' as any or unknown
      result.warn(`Error loading or parsing custom tokens file: ${e.message}`, { node: root, stylelintType: 'parseError' });
      return;
    }

    if (Object.keys(activeCategories).length === 0) {
      return;
    }

    root.walkDecls((decl: Declaration) => {
      if (!decl.prop || !decl.value || !decl.source?.start) {
        return;
      }

      const propertyName = decl.prop.toLowerCase();

      for (const categoryName in activeCategories) {
        const category: TokenCategory = activeCategories[categoryName];

        if (category.properties.includes(propertyName)) {
          const parsedValue = valueParser(decl.value);

          parsedValue.walk((node: ValueNode) => {
            let originalValue = node.value;
            let isPxValueNode = hasPxUnit(originalValue);
            let isUnitlessZeroNode = originalValue === '0';

            // Skip if the node is not a word or a px value or a unitless zero
            if (node.type !== 'word' || (!isPxValueNode && !isUnitlessZeroNode)) return
            // Skip if the node is a unitless zero and there is no token for it
            if (isUnitlessZeroNode && !category.tokens['0']) return

            const numericPxValue = extractPxValue(originalValue);

            // Skip if the node is not a px value and there is no token for it
            if (!isUnitlessZeroNode && numericPxValue === null) return

            // Calculate the start index of the value string within the declaration
            // decl.prop is the property name, decl.raws.between is typically ": " or ":"
            const valueOffset = decl.prop.length + (decl.raws.between || ':').length;
            const valueNodeStartIndexInDecl = valueOffset + node.sourceIndex;
            const valueNodeEndIndexInDecl = valueNodeStartIndexInDecl + originalValue.length;

            if (category.tokens[originalValue]) {
              const tokenToSuggest = category.tokens[originalValue];
              if (context.fix && node.value !== tokenToSuggest) {
                node.value = tokenToSuggest;
                decl.value = parsedValue.toString();
              }
              stylelint.utils.report({
                message: (messages.exactMatch as (...args: any[]) => string)(tokenToSuggest, originalValue, propertyName),
                node: decl,
                index: valueNodeStartIndexInDecl,
                endIndex: valueNodeEndIndexInDecl,
                result: result,
                ruleName,
              } as Problem);

              // Return false to stop the walk
              return false;
            }

            // If the node is a px value, check for close matches
            if (numericPxValue !== null && tokenMatchMargin > 0) {
              const closeMatches: { tokenPxValue: string; tokenName: string; diff: number }[] = [];
              for (const tokenPxEntry in category.tokens) {
                // Only compare with tokens that are px or unitless zero
                if (hasPxUnit(tokenPxEntry) || tokenPxEntry === '0') {
                  const numTokenPx = extractPxValue(tokenPxEntry);
                  if (numTokenPx !== null) {
                    const diff = Math.abs(numericPxValue - numTokenPx);
                    if (diff > 0 && diff <= tokenMatchMargin) {
                      closeMatches.push({
                        tokenPxValue: tokenPxEntry,
                        tokenName: category.tokens[tokenPxEntry],
                        diff,
                      });
                    }
                  }
                }
              }

              // If there are close matches, report the best match
              if (closeMatches.length > 0) {
                closeMatches.sort((a, b) => a.diff - b.diff);
                const bestMatch = closeMatches[0];
                let otherSuggestionsStr = '';
                if (closeMatches.length > 1) {
                  otherSuggestionsStr = closeMatches.slice(1).map(m => `${m.tokenName} ('${m.tokenPxValue}')`).join(', ');
                }

                // Report the best match
                stylelint.utils.report({
                  message: (messages.closeMatch as (...args: any[]) => string)(bestMatch.tokenName, bestMatch.tokenPxValue, originalValue, otherSuggestionsStr),
                  node: decl,
                  index: valueNodeStartIndexInDecl,
                  endIndex: valueNodeEndIndexInDecl,
                  result: result,
                  ruleName,
                  severity: "warning",
                } as Problem);
              }
            }
          });
        }
      }
    });
  };
};

// Create the plugin using the rule implementation
const plugin = stylelint.createPlugin(ruleName, ruleImpl as Rule<boolean, RuleOptions>);

// Attach messages and meta to the exported plugin, not the ruleImpl directly
if (plugin && typeof plugin === 'object' && plugin !== null) {
  (plugin as any).messages = messages; // For discoverability by Stylelint
  (plugin as any).ruleName = ruleName; // For discoverability by Stylelint
  (plugin as any).meta = {
    url: "https://github.com/YOUR_USERNAME/stylelint-text-app-token-guard/blob/main/README.md", // TODO: Replace with your actual repo URL
    fixable: true,
  } as RuleMeta;
}

export default plugin; 
