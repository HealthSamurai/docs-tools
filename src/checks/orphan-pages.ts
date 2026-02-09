import { join, dirname, normalize } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { extractLinks, isExternal, isImageHref } from "../lib/links";
import { readFile } from "../lib/files";

/**
 * Normalize a link target to a path relative to docsDir.
 */
function normalizeLink(sourceFile: string, href: string): string {
  if (!href) return "";

  // Strip anchor
  const noAnchor = href.split("#")[0];
  if (!noAnchor) return "";

  // Skip external
  if (isExternal(noAnchor)) return "";

  const decoded = decodeURIComponent(noAnchor);
  const sourceDir = dirname(sourceFile);

  let resolved: string;
  if (decoded.startsWith("/")) {
    resolved = decoded.slice(1);
  } else {
    resolved = normalize(join(sourceDir, decoded));
  }

  // Handle trailing slash -> README.md
  if (resolved.endsWith("/")) {
    resolved += "README.md";
  }

  return resolved;
}

export const orphanPages: Check = {
  id: "orphan-pages",
  name: "Orphan Pages",
  severity: "warning",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    // Build incoming link graph
    const incomingLinks = new Map<string, Set<string>>();

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      const links = extractLinks(content);

      for (const link of links) {
        if (isExternal(link.href) || isImageHref(link.href)) continue;

        const target = normalizeLink(file, link.href);
        if (!target || !target.endsWith(".md")) continue;

        if (!incomingLinks.has(target)) {
          incomingLinks.set(target, new Set());
        }
        incomingLinks.get(target)!.add(file);
      }
    }

    // Entry points that don't need incoming links
    const entryPoints = new Set([
      ctx.config.summary,
      "README.md",
      "getting-started/README.md",
    ]);

    for (const file of ctx.files) {
      if (entryPoints.has(file)) continue;
      if (file === ctx.config.summary) continue;
      if (file.endsWith("README.md")) continue;

      // Check for hidden pages (frontmatter hidden: true)
      const content = await readFile(join(ctx.docsDir, file));
      if (content && /hidden:\s*true/.test(content.slice(0, 500))) continue;

      if (!incomingLinks.has(file)) {
        issues.push({
          file,
          message: "No incoming links from other docs",
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
