import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

/**
 * Extract all <img> tags from content (handles multi-line tags).
 * Returns tag string + line number of the opening <img.
 */
function extractImgTags(content: string): { tag: string; lineNum: number }[] {
  const results: { tag: string; lineNum: number }[] = [];
  // Collect non-code-block lines with their numbers
  const lines: { line: string; lineNum: number }[] = [];
  for (const entry of contentLines(content)) {
    lines.push(entry);
  }
  const joined = lines.map((l) => l.line).join("\n");

  const re = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(joined)) !== null) {
    // Remove inline code spans
    const withoutCode = match[0].replace(/`[^`]+`/g, "");
    if (!/<img/i.test(withoutCode)) continue;

    // Find line number: count newlines before match start
    const before = joined.slice(0, match.index);
    const idx = before.split("\n").length - 1;
    results.push({ tag: withoutCode, lineNum: lines[idx]?.lineNum ?? 1 });
  }
  return results;
}

export const imageAlt: Check = {
  id: "image-alt",
  name: "Image Alt Text",
  severity: "warning",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      for (const { line, lineNum } of contentLines(content)) {
        // Markdown: ![](path) - empty alt
        if (/!\[\]\([^)]+\)/.test(line)) {
          issues.push({
            file,
            line: lineNum,
            message: "Markdown image without alt text",
          });
        }
      }

      // HTML: <img> without alt or with empty alt (handles multi-line tags)
      for (const { tag, lineNum } of extractImgTags(content)) {
        if (/alt\s*=\s*["']\s*["']/i.test(tag)) {
          issues.push({
            file,
            line: lineNum,
            message: "img tag with empty alt",
          });
        } else if (!/alt\s*=/i.test(tag)) {
          issues.push({
            file,
            line: lineNum,
            message: "img tag without alt attribute",
          });
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
