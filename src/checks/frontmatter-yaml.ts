import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { extractFrontmatter } from "../lib/markdown";
import { readFile } from "../lib/files";

export const frontmatterYaml: Check = {
  id: "frontmatter-yaml",
  name: "Frontmatter YAML",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const yaml = await import("js-yaml");
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      const fm = extractFrontmatter(content);
      if (!fm) continue;

      try {
        yaml.load(fm.yaml);
      } catch (e: unknown) {
        const err = e as { mark?: { line?: number }; reason?: string };
        const line = err.mark?.line != null ? err.mark.line + fm.offset : undefined;
        issues.push({
          file,
          line,
          message: `Invalid YAML frontmatter: ${err.reason ?? String(e)}`,
        });
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
