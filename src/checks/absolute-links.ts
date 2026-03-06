import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

const DEFAULT_DOMAINS = ["docs.aidbox.app", "www.health-samurai.io/docs"];

export const absoluteLinks: Check = {
  id: "absolute-links",
  name: "Absolute Links",
  description: "Link uses a hardcoded absolute URL to your own docs site. Use a relative markdown link instead (e.g. ./page.md).",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    // Get configured domains and exclusions
    const checkConfig = ctx.config.checks["absolute-links"] as
      | { domains?: string[]; exclude_files?: string[] }
      | undefined;
    const domains = checkConfig?.domains ?? DEFAULT_DOMAINS;
    const excludeFiles = checkConfig?.exclude_files ?? [];

    // Build patterns from domains
    const patterns = domains.map(
      (d) => new RegExp(`https?://${d.replace(/\./g, "\\.")}`, "gi"),
    );

    for (const file of ctx.files) {
      if (excludeFiles.some((pattern) => file.includes(pattern))) continue;
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      for (const { line, lineNum } of contentLines(content)) {
        for (const pattern of patterns) {
          pattern.lastIndex = 0;
          if (pattern.test(line)) {
            issues.push({
              file,
              line: lineNum,
              message: `Absolute link to documentation domain`,
            });
            break; // one issue per line
          }
        }
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      description: this.description,
      severity: this.severity,
      issues,
      filesChecked: ctx.files.length,
    };
  },
};
