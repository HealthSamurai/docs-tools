import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { extractLinks, isExternal, isImageHref } from "../lib/links";
import { readFile } from "../lib/files";

/**
 * Detects pages with no outgoing internal links (dead ends).
 * Opposite of orphan-pages which finds pages with no incoming links.
 */
export const deadEndPages: Check = {
  id: "dead-end-pages",
  name: "Dead-end Pages",
  severity: "warning",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      if (file === ctx.config.summary) continue;
      if (file.endsWith("README.md")) continue;
      if (file.includes("deprecated")) continue;

      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      const links = extractLinks(content);
      const hasInternalLink = links.some((link) => {
        if (isExternal(link.href) || isImageHref(link.href)) return false;
        const href = link.href.split("#")[0];
        if (!href) return false;
        return true;
      });

      if (!hasInternalLink) {
        issues.push({
          file,
          message: "No outgoing links to other docs",
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
