import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { readFile } from "../lib/files";
import { walkLines } from "../lib/markdown";

/**
 * Known GitBook block widgets that require matching end tags.
 */
const BLOCK_WIDGETS = new Set([
  "hint",
  "tabs",
  "tab",
  "content-ref",
  "stepper",
  "step",
  "code",
  "swagger",
  "swagger-description",
  "swagger-parameter",
  "swagger-response",
]);

/**
 * Self-closing widgets that don't require an end tag.
 */
const SELF_CLOSING_WIDGETS = new Set(["embed", "file"]);

/**
 * Widget nesting rules: child -> required parent.
 */
const NESTING_RULES: Record<string, string> = {
  tab: "tabs",
  step: "stepper",
};

interface WidgetTag {
  name: string;
  isEnd: boolean;
  lineNum: number;
  raw: string;
}

/**
 * Extract all {% widget %} and {% endwidget %} tags from content,
 * skipping code blocks.
 */
function extractWidgetTags(content: string): WidgetTag[] {
  const tags: WidgetTag[] = [];
  // Match {% widgetname ... %} and {% endwidgetname %}
  const pattern = /\{%\s*(end)?([a-z][-a-z]*)\b[^%]*%\}/g;

  for (const { line, lineNum, inCodeBlock } of walkLines(content)) {
    if (inCodeBlock) continue;

    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(line)) !== null) {
      tags.push({
        name: match[2],
        isEnd: match[1] === "end",
        lineNum,
        raw: match[0],
      });
    }
  }

  return tags;
}

export const unparsedWidgets: Check = {
  id: "unparsed-widgets",
  name: "Unparsed Widgets",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      const tags = extractWidgetTags(content);
      if (tags.length === 0) continue;

      // Check for unknown widget types
      for (const tag of tags) {
        const baseName = tag.name;
        if (!BLOCK_WIDGETS.has(baseName) && !SELF_CLOSING_WIDGETS.has(baseName)) {
          issues.push({
            file,
            line: tag.lineNum,
            message: `Unknown widget type: ${tag.raw}`,
          });
        }
      }

      // Check matching open/close tags using a stack
      const stack: WidgetTag[] = [];

      for (const tag of tags) {
        if (!BLOCK_WIDGETS.has(tag.name)) continue;

        if (!tag.isEnd) {
          stack.push(tag);
        } else {
          // Find matching opening tag (search from top of stack)
          let found = false;
          for (let i = stack.length - 1; i >= 0; i--) {
            if (stack[i].name === tag.name) {
              stack.splice(i, 1);
              found = true;
              break;
            }
          }
          if (!found) {
            issues.push({
              file,
              line: tag.lineNum,
              message: `Closing widget without matching opening tag: ${tag.raw}`,
            });
          }
        }
      }

      // Report unclosed widgets remaining on stack
      for (const unclosed of stack) {
        issues.push({
          file,
          line: unclosed.lineNum,
          message: `Widget not closed: ${unclosed.raw}`,
        });
      }

      // Check nesting rules
      const openStack: string[] = [];
      for (const tag of tags) {
        if (!BLOCK_WIDGETS.has(tag.name)) continue;

        if (!tag.isEnd) {
          const requiredParent = NESTING_RULES[tag.name];
          if (requiredParent && !openStack.includes(requiredParent)) {
            issues.push({
              file,
              line: tag.lineNum,
              message: `Widget {% ${tag.name} %} must be inside {% ${requiredParent} %}`,
            });
          }
          openStack.push(tag.name);
        } else {
          const idx = openStack.lastIndexOf(tag.name);
          if (idx !== -1) openStack.splice(idx, 1);
        }
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      severity: this.severity,
      issues,
      filesChecked: ctx.files.length,
    };
  },
};
