import { join, dirname, normalize } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { extractLinks, isExternal, isImageHref } from "../lib/links";
import { readFile, fileExists } from "../lib/files";

/**
 * Resolve a relative link from a source file to an absolute path.
 */
function resolveLink(docsDir: string, sourceFile: string, href: string): string {
  const decoded = decodeURIComponent(href);
  const sourceDir = dirname(join(docsDir, sourceFile));
  return normalize(join(sourceDir, decoded));
}

/**
 * Try multiple path variants to find if a link target exists.
 */
async function linkTargetExists(
  docsDir: string,
  sourceFile: string,
  rawHref: string,
): Promise<boolean> {
  if (!rawHref || rawHref === "") return true;

  const resolved = resolveLink(docsDir, sourceFile, rawHref);

  // Try exact path
  if (await fileExists(resolved)) return true;

  // Try with .md extension
  if (!resolved.endsWith(".md")) {
    if (await fileExists(resolved + ".md")) return true;
  }

  // Try as directory with README.md
  if (await fileExists(join(resolved, "README.md"))) return true;

  // If ends with /, try basename.md (e.g. access-control/ -> access-control.md)
  if (rawHref.endsWith("/")) {
    const base = rawHref.slice(0, -1);
    const basePath = resolveLink(docsDir, sourceFile, base + ".md");
    if (await fileExists(basePath)) return true;

    // Try {dirname}/{dirname}.md (e.g. access-control/ -> access-control/access-control.md)
    const dirName = base.split("/").pop() || "";
    if (dirName) {
      const innerPath = resolveLink(docsDir, sourceFile, base + "/" + dirName + ".md");
      if (await fileExists(innerPath)) return true;
    }
  }

  // Try with spaces decoded/encoded
  const withSpaces = resolved.replace(/%20/g, " ");
  if (withSpaces !== resolved && (await fileExists(withSpaces))) return true;

  return false;
}

export const brokenLinks: Check = {
  id: "broken-links",
  name: "Broken Links",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      const links = extractLinks(content);

      for (const link of links) {
        if (isExternal(link.href)) continue;
        if (!link.href) continue;
        if (isImageHref(link.href)) continue; // images checked by missing-images

        // Skip placeholder links
        if (
          link.href.includes("{{") ||
          link.href.includes("<") ||
          link.href === "broken-reference"
        ) {
          continue;
        }

        const exists = await linkTargetExists(ctx.docsDir, file, link.href);
        if (!exists) {
          issues.push({
            file,
            line: link.lineNum,
            message: `Broken link: [${link.text}](${link.href})`,
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
