import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { readFile, fileExists } from "../lib/files";

export const redirects: Check = {
  id: "redirects",
  name: "Redirects",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    const content = await readFile(ctx.redirectsPath);
    if (!content) {
      // No redirects file is OK
      return {
        checkId: this.id,
        name: this.name,
        severity: this.severity,
        issues: [],
        filesChecked: 0,
      };
    }

    const yaml = await import("js-yaml");
    let data: unknown;
    try {
      data = yaml.load(content);
    } catch {
      issues.push({
        file: ctx.config.redirects,
        message: "Invalid YAML in redirects file",
      });
      return {
        checkId: this.id,
        name: this.name,
        severity: this.severity,
        issues,
        filesChecked: 1,
      };
    }

    const redirectsMap =
      (data as { redirects?: Record<string, string> })?.redirects ?? {};
    let total = 0;

    for (const [, target] of Object.entries(redirectsMap)) {
      total++;
      // Target should be a .md file relative to docs dir
      const targetStr = String(target);
      if (!targetStr.endsWith(".md")) continue;

      const targetPath = join(ctx.docsDir, targetStr);
      if (!(await fileExists(targetPath))) {
        issues.push({
          file: ctx.config.redirects,
          message: `Redirect target missing: ${targetStr}`,
        });
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      severity: this.severity,
      issues,
      filesChecked: total,
    };
  },
};
