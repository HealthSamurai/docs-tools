#!/usr/bin/env bun
/**
 * Migrate documentation from the monorepo `documentation` into per-product repos
 * (aidbox-docs, auditbox-docs, formbox-docs).
 *
 * Usage:
 *   bun scripts/migrate.ts [--docs-root <path>] [--repos-root <path>] [--product <id>] [--dry-run]
 *
 * Defaults:
 *   --docs-root  ../documentation   (relative to cwd)
 *   --repos-root ..                 (sibling directories)
 *   --product    all                (aidbox, auditbox, formbox)
 */

import { join, resolve, relative, dirname, basename } from "path";
import { Glob } from "bun";
import yaml from "js-yaml";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function getArg(name: string, fallback: string): string {
  const idx = args.indexOf(`--${name}`);
  return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
}
const DRY_RUN = args.includes("--dry-run");
const DOCS_ROOT = resolve(getArg("docs-root", "../documentation"));
const REPOS_ROOT = resolve(getArg("repos-root", ".."));
const ONLY_PRODUCT = getArg("product", "all");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const RESET = "\x1b[0m";

function log(msg: string) {
  console.log(msg);
}
function info(msg: string) {
  console.log(`${DIM}  ${msg}${RESET}`);
}
function ok(msg: string) {
  console.log(`  ${GREEN}\u2713${RESET} ${msg}`);
}
function warn(msg: string) {
  console.log(`  ${YELLOW}\u26A0${RESET} ${msg}`);
}
function fail(msg: string) {
  console.log(`  ${RED}\u2717${RESET} ${msg}`);
}

async function dirExists(dir: string): Promise<boolean> {
  const proc = Bun.spawn(["test", "-d", dir], { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

async function copyDir(src: string, dst: string): Promise<number> {
  const glob = new Glob("**/*");
  let count = 0;
  for await (const path of glob.scan({ cwd: src, absolute: false, dot: true })) {
    const srcPath = join(src, path);
    const dstPath = join(dst, path);
    const file = Bun.file(srcPath);
    // skip directories (glob yields files only in Bun)
    if (!(await file.exists())) continue;
    if (DRY_RUN) {
      info(`copy ${path}`);
    } else {
      await Bun.write(dstPath, file);
    }
    count++;
  }
  return count;
}

async function cleanDir(dir: string): Promise<void> {
  if (DRY_RUN) {
    info(`would clean ${dir}`);
    return;
  }
  const proc = Bun.spawn(["rm", "-rf", dir], { stdout: "ignore", stderr: "ignore" });
  await proc.exited;
  await mkdirp(dir);
}

async function mkdirp(dir: string): Promise<void> {
  const proc = Bun.spawn(["mkdir", "-p", dir], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc.exited;
}

async function readText(path: string): Promise<string | null> {
  const f = Bun.file(path);
  if (!(await f.exists())) return null;
  return f.text();
}

async function writeText(path: string, content: string): Promise<void> {
  if (DRY_RUN) {
    info(`write ${path} (${content.length} bytes)`);
    return;
  }
  await mkdirp(dirname(path));
  await Bun.write(path, content);
}

async function globFiles(dir: string, pattern: string): Promise<string[]> {
  try {
    const stat = await Bun.file(join(dir, ".")).exists().catch(() => false);
    // Check dir exists by trying to open it
    const proc = Bun.spawn(["test", "-d", dir], { stdout: "ignore", stderr: "ignore" });
    if ((await proc.exited) !== 0) return [];
  } catch {
    return [];
  }
  const glob = new Glob(pattern);
  const files: string[] = [];
  for await (const path of glob.scan({ cwd: dir, absolute: false })) {
    files.push(path);
  }
  return files.sort();
}

// ---------------------------------------------------------------------------
// Image path rewriting
// ---------------------------------------------------------------------------

/**
 * Rewrite .gitbook/assets/ references to ../assets/ format.
 *
 * For a file at docs/a/b/page.md referencing ../../.gitbook/assets/X.png:
 *   -> ../../../assets/X.png  (one more ../ because assets/ is at repo root)
 *
 * Pattern: (../)*.gitbook/assets/ -> (../)*../assets/
 *
 * Also handles optional prefix stripping (e.g. "auditbox/" for auditbox assets).
 */
/**
 * @param content  - markdown file content
 * @param filePath - path relative to docs/ dir (e.g. "getting-started/page.md")
 * @param opts.stripAssetPrefix - prefix to strip from asset filenames (e.g. "auditbox/")
 */
function rewriteImagePaths(
  content: string,
  filePath: string,
  opts?: { stripAssetPrefix?: string },
): string {
  const prefix = opts?.stripAssetPrefix
    ? opts.stripAssetPrefix.replace(/\/$/, "") + "/"
    : "";

  // Calculate the correct relative path from this file to repo-root/assets/
  // File is at docs/<filePath>, assets/ is at repo root (sibling to docs/)
  const depth = filePath.split("/").length; // e.g. "a/b/page.md" = 3 segments = 3 levels up to repo root
  const toRoot = "../".repeat(depth); // from docs/a/b/page.md -> ../../../ = repo root
  const assetsRef = toRoot + "assets/";

  // Replace any (../)*[.gitbook/assets/][prefix] with the correct path
  const pattern = new RegExp(
    `(?:\\.\\.\\/)*\\.gitbook\\/assets\\/${escapeRegex(prefix)}`,
    "g",
  );
  let result = content.replace(pattern, assetsRef);

  // Also strip prefix from already-rewritten relative paths:
  // ../assets/auditbox/X -> ../assets/X
  if (prefix) {
    const alreadyRewritten = new RegExp(
      `((?:\\.\\.\\/)+assets\\/)${escapeRegex(prefix)}`,
      "g",
    );
    result = result.replace(alreadyRewritten, assetsRef);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Absolute link rewriting
// ---------------------------------------------------------------------------

/**
 * Rewrite absolute links to docs.aidbox.app into relative paths (for aidbox-docs)
 * or leave them as-is for cross-product repos.
 *
 * For aidbox-docs: https://docs.aidbox.app/docs/aidbox/X -> relative path to X
 * For aidbox-docs: https://docs.aidbox.app/X -> relative path to X (old format)
 *
 * @param filePath - path relative to docs/ dir
 * @param docsDir  - path to target docs/ dir (to resolve relative paths)
 */
function rewriteAbsoluteLinks(
  content: string,
  filePath: string,
  docsDir: string,
): string {
  // Match [text](https://docs.aidbox.app/...) and [text](https://www.health-samurai.io/docs/aidbox/...) links
  const pattern = /(\[[^\]]*\])\(https:\/\/(?:docs\.aidbox\.app\/(?:docs\/aidbox\/)?|(?:www\.)?health-samurai\.io\/docs\/aidbox\/)([^)]*)\)/g;

  // Collect replacements (can't use async in replace, so check files sync)
  const replacements: Array<{ match: string; replacement: string }> = [];

  let m;
  while ((m = pattern.exec(content)) !== null) {
    const [match, text, path] = m;
    const fileDir = dirname(filePath);
    const depth = fileDir === "." ? 0 : fileDir.split("/").length;
    const toDocsRoot = depth > 0 ? "../".repeat(depth) : "./";

    const [cleanPath, anchor] = path.split("#");
    const anchorSuffix = anchor ? `#${anchor}` : "";

    const mdPath = cleanPath.endsWith("/")
      ? cleanPath + "README.md"
      : /\.\w+$/.test(cleanPath)
        ? cleanPath
        : cleanPath + ".md";

    // Only rewrite if the target file actually exists
    const targetFile = join(docsDir, mdPath);
    if (require("fs").existsSync(targetFile)) {
      replacements.push({ match, replacement: `${text}(${toDocsRoot}${mdPath}${anchorSuffix})` });
    }
  }

  let result = content;
  for (const { match, replacement } of replacements) {
    result = result.replace(match, replacement);
  }
  return result;
}

/**
 * Rewrite absolute docs.aidbox.app links to www.health-samurai.io.
 * Handles both new format (docs.aidbox.app/docs/aidbox/X) and
 * old GitBook format (docs.aidbox.app/X).
 */
function rewriteDocsAidboxDomain(content: string): string {
  // New format: docs.aidbox.app/docs/aidbox/X → www.health-samurai.io/docs/aidbox/X
  let result = content.replace(
    /https:\/\/docs\.aidbox\.app\/docs\/aidbox\//g,
    "https://www.health-samurai.io/docs/aidbox/",
  );
  // Old format: docs.aidbox.app/X (not /docs/aidbox/) → www.health-samurai.io/docs/aidbox/X
  result = result.replace(
    /https:\/\/docs\.aidbox\.app\/(?!docs\/)/g,
    "https://www.health-samurai.io/docs/aidbox/",
  );
  return result;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Redirects conversion
// ---------------------------------------------------------------------------

/**
 * Extract redirects from .gitbook.yaml and convert to redirects.yaml format.
 */
async function convertRedirects(gitbookYamlPath: string): Promise<string> {
  const text = await readText(gitbookYamlPath);
  if (!text) return "redirects: {}\n";

  const parsed = yaml.load(text) as Record<string, unknown>;
  const redirects = parsed?.redirects;
  if (!redirects || typeof redirects !== "object") return "redirects: {}\n";

  return yaml.dump({ redirects }, { lineWidth: -1 });
}

// ---------------------------------------------------------------------------
// SUMMARY extraction for formbox
// ---------------------------------------------------------------------------

/**
 * Extract the Aidbox Forms section from the main SUMMARY.md.
 * - Lines 326-373: modules/aidbox-forms/...
 * - Lines 572-576: reference/aidbox-forms-reference/...
 *
 * Rewrites paths: removes modules/aidbox-forms/ prefix, maps reference/ to reference/
 */
function extractFormboxSummary(fullSummary: string): string {
  const lines = fullSummary.split("\n");
  const formsLines: string[] = [];
  const refLines: string[] = [];

  let inFormsSection = false;
  let formsIndent = -1;

  let inRefSection = false;
  let refIndent = -1;

  for (const line of lines) {
    // Detect forms module section start
    if (line.includes("modules/aidbox-forms/")) {
      if (!inFormsSection) {
        inFormsSection = true;
        formsIndent = line.search(/\S/);
      }

      if (inFormsSection) {
        formsLines.push(line);
      }
      continue;
    }

    // If we're inside forms section, check if we've exited (lower or equal indent, non-empty)
    if (inFormsSection) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const indent = line.search(/\S/);
      if (indent <= formsIndent) {
        inFormsSection = false;
      } else {
        formsLines.push(line);
        continue;
      }
    }

    // Detect reference section
    if (line.includes("reference/aidbox-forms-reference/")) {
      if (!inRefSection) {
        inRefSection = true;
        refIndent = line.search(/\S/);
      }
      refLines.push(line);
      continue;
    }

    if (inRefSection) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const indent = line.search(/\S/);
      if (indent <= refIndent) {
        inRefSection = false;
      } else {
        refLines.push(line);
        continue;
      }
    }
  }

  // Rewrite paths
  const rewritePath = (line: string): string => {
    // modules/aidbox-forms/X -> X (flatten to root)
    let result = line.replace(/modules\/aidbox-forms\//g, "");
    // reference/aidbox-forms-reference/X -> reference/X
    result = result.replace(/reference\/aidbox-forms-reference\//g, "reference/");
    return result;
  };

  // De-indent: find minimum indent and remove it
  const allLines = [...formsLines, ...refLines];
  const minIndent = allLines
    .filter((l) => l.trim())
    .reduce((min, l) => Math.min(min, l.search(/\S/)), Infinity);

  const deindent = (line: string): string => {
    if (!line.trim()) return "";
    return line.slice(Math.min(minIndent, line.search(/\S/)));
  };

  const guidesSection = formsLines.map((l) => deindent(rewritePath(l)));
  const referenceSection = refLines.map((l) => deindent(rewritePath(l)));

  return [
    "# Table of contents",
    "",
    "## Guides",
    ...guidesSection,
    "",
    "## Reference",
    ...referenceSection,
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Cross-link rewriting for formbox
// ---------------------------------------------------------------------------

/**
 * Try to map an aidbox-relative path to a product-internal path using
 * structural path mappings (e.g. reference/aidbox-forms-reference/ → reference/).
 * Returns the mapped path if it exists in knownPaths, null otherwise.
 */
function mapToInternalPath(
  aidboxRelPath: string,
  knownPaths: Set<string>,
  pathMappings: Array<{ from: string; to: string }>,
): string | null {
  for (const { from, to } of pathMappings) {
    if (aidboxRelPath.includes(from)) {
      const mapped = aidboxRelPath.replace(from, to);
      if (knownPaths.has(mapped) || knownPaths.has(mapped + "/README")) {
        return mapped;
      }
    }
  }
  return null;
}

/**
 * Rewrite internal links that point outside of product content
 * to external links to www.health-samurai.io/docs/aidbox/.
 *
 * Also handles structural path changes via pathMappings: links referencing
 * the old aidbox-docs structure are mapped back to their new product-internal
 * paths when the target exists.
 *
 * @param sourcePrefix - the module's path prefix in the original aidbox-docs
 *   (e.g. "modules/aidbox-forms" for formbox). Used to correctly resolve
 *   relative links that escape the product's docs root back to aidbox paths.
 */
function rewriteExternalLinks(
  content: string,
  filePath: string,
  productPaths: Set<string>,
  pathMappings: Array<{ from: string; to: string }> = [],
  sourcePrefix: string = "",
): string {
  // Match markdown links: [text](path)
  const linkPattern = /(\[[^\]]*\])\(([^)]+)\)/g;

  return content.replace(linkPattern, (match, text, href) => {
    // Skip external links, anchors, embeds
    if (
      href.startsWith("http") ||
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.includes("{{")
    ) {
      return match;
    }

    // Skip image references
    if (/\.(png|jpg|jpeg|gif|svg|webp|avif)$/i.test(href)) return match;

    // Strip anchor
    const [cleanHref, anchor] = href.split("#");
    if (!cleanHref) return match;

    // Skip non-relative links
    if (!cleanHref.includes("../")) return match;

    // Resolve the relative path from the file's directory
    const fileDir = dirname(filePath);
    const resolved = join(fileDir, cleanHref)
      .replace(/\.md$/, "")
      .replace(/\/README$/, "");

    // If it resolves to a known product path, keep as-is
    if (productPaths.has(resolved) || productPaths.has(resolved + "/README")) {
      return match;
    }

    // Reconstruct the original aidbox-docs file path by reversing the migration mapping,
    // then resolve the href against it to get the correct aidbox-relative path.
    let aidboxPath: string;
    if (sourcePrefix) {
      // Reverse path mappings to find original file location
      let originalPath = filePath;
      let mapped = false;
      for (const { from, to } of pathMappings) {
        if (to && filePath.startsWith(to)) {
          originalPath = from + filePath.slice(to.length);
          mapped = true;
          break;
        }
      }
      if (!mapped) {
        originalPath = sourcePrefix + "/" + filePath;
      }
      // Resolve href against the original directory
      const originalDir = dirname(originalPath);
      const aidboxResolved = join(originalDir, cleanHref)
        .replace(/\.md$/, "")
        .replace(/\/README$/, "");
      // Strip any leading ../ (shouldn't escape aidbox docs root)
      aidboxPath = aidboxResolved.replace(/^(\.\.\/?)+/, "");
    } else {
      aidboxPath = cleanHref
        .replace(/^(\.\.\/)+/, "")
        .replace(/\.md$/, "")
        .replace(/\/README$/, "");
    }
    const anchorSuffix = anchor ? `#${anchor}` : "";

    // Check if this path maps to product-internal content
    // (e.g. reference/aidbox-forms-reference/X → reference/X)
    const mappedPath = mapToInternalPath(aidboxPath, productPaths, pathMappings);
    if (mappedPath !== null) {
      const depth = fileDir === "." ? 0 : fileDir.split("/").length;
      const toDocsRoot = depth > 0 ? "../".repeat(depth) : "./";
      return `${text}(${toDocsRoot}${mappedPath}${anchorSuffix})`;
    }

    // It's outside formbox — rewrite to external aidbox docs URL
    return `${text}(https://www.health-samurai.io/docs/aidbox/${aidboxPath}${anchorSuffix})`;
  });
}

// ---------------------------------------------------------------------------
// Find referenced images (for formbox — only copy what's needed)
// ---------------------------------------------------------------------------

async function findReferencedImages(
  docsDir: string,
): Promise<Set<string>> {
  const images = new Set<string>();
  const mdFiles = await globFiles(docsDir, "**/*.md");

  for (const file of mdFiles) {
    const content = await readText(join(docsDir, file));
    if (!content) continue;

    // Match image references in both markdown and HTML contexts:
    // - Markdown: ![alt](../../.gitbook/assets/file.png)
    // - HTML: <img src="../../.gitbook/assets/file (1).png">
    // Filenames may contain spaces and parentheses (e.g. "image (1) (1).png")
    let match;

    // HTML context: quoted paths (allows spaces and parens)
    const htmlPattern1 = /\.gitbook\/assets\/([^"'\n]+?)(?=["'])/g;
    while ((match = htmlPattern1.exec(content)) !== null) {
      images.add(match[1].trim());
    }

    // Markdown context: paths in parens (no spaces allowed — markdown convention)
    const mdPattern1 = /\.gitbook\/assets\/([^\s"')<>\n]+)/g;
    while ((match = mdPattern1.exec(content)) !== null) {
      images.add(match[1].trim());
    }

    // Same for already-rewritten ../assets/ paths
    const htmlPattern2 = /(?:\.\.\/)+assets\/([^"'\n]+?)(?=["'])/g;
    while ((match = htmlPattern2.exec(content)) !== null) {
      images.add(match[1].trim());
    }

    const mdPattern2 = /(?:\.\.\/)+assets\/([^\s"')<>\n]+)/g;
    while ((match = mdPattern2.exec(content)) !== null) {
      images.add(match[1].trim());
    }
  }

  return images;
}

// ---------------------------------------------------------------------------
// Product migrations
// ---------------------------------------------------------------------------

async function migrateAidbox(): Promise<void> {
  log(`\n${BOLD}=== Migrating Aidbox ===${RESET}`);

  const srcDocs = join(DOCS_ROOT, "docs");
  const srcAssets = join(DOCS_ROOT, "docs/.gitbook/assets");
  const srcGitbook = join(DOCS_ROOT, ".gitbook.yaml");
  const target = join(REPOS_ROOT, "aidbox-docs");

  // Verify paths exist
  if (!(await Bun.file(join(srcDocs, "SUMMARY.md")).exists())) {
    fail(`Source docs not found: ${srcDocs}`);
    return;
  }

  if (!(await dirExists(target))) {
    fail(`Target repo not found: ${target}. Clone it first.`);
    return;
  }

  // 1. Clean target directories
  info("Cleaning target docs/ and assets/...");
  await cleanDir(join(target, "docs"));
  await cleanDir(join(target, "assets"));

  // 2. Copy docs (excluding .gitbook/)
  info("Copying docs...");
  const mdFiles = await globFiles(srcDocs, "**/*.md");
  let docCount = 0;
  for (const file of mdFiles) {
    const srcPath = join(srcDocs, file);
    const dstPath = join(target, "docs", file);
    if (!DRY_RUN) {
      await mkdirp(dirname(dstPath));
      await Bun.write(dstPath, Bun.file(srcPath));
    }
    docCount++;
  }
  ok(`Copied ${docCount} markdown files`);

  // 3. Copy assets (merge from docs/.gitbook/assets/ and root .gitbook/assets/)
  info("Copying assets...");
  let assetCount = await copyDir(srcAssets, join(target, "assets"));
  // Root .gitbook/assets/ has additional files (webp variants, newer uploads)
  const srcAssetsRoot = join(DOCS_ROOT, ".gitbook/assets");
  const rootCount = await copyDir(srcAssetsRoot, join(target, "assets"));
  assetCount += rootCount;
  ok(`Copied ${assetCount} assets`);

  // 4. Copy SUMMARY.md to repo root
  info("Copying SUMMARY.md...");
  const summaryContent = await readText(join(srcDocs, "SUMMARY.md"));
  if (summaryContent) {
    await writeText(join(target, "SUMMARY.md"), summaryContent);
    ok("SUMMARY.md copied");
  }

  // 5. Convert redirects
  info("Converting redirects...");
  const redirectsYaml = await convertRedirects(srcGitbook);
  await writeText(join(target, "redirects.yaml"), redirectsYaml);
  ok("redirects.yaml generated");

  // 6. Rewrite image paths in all markdown files
  info("Rewriting image paths...");
  let rewriteCount = 0;
  const targetMdFiles = await globFiles(join(target, "docs"), "**/*.md");
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    const rewritten = rewriteImagePaths(content, file);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      rewriteCount++;
    }
  }
  ok(`Rewrote image paths in ${rewriteCount} files`);

  // 7. Rewrite absolute links to relative
  info("Rewriting absolute links...");
  let absLinkCount = 0;
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    const rewritten = rewriteAbsoluteLinks(content, file, join(target, "docs"));
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      absLinkCount++;
    }
  }
  ok(`Rewrote absolute links in ${absLinkCount} files`);

  // 8. Update docs-lint.yaml
  info("Updating docs-lint.yaml...");
  const aidboxLintConfig = [
    "docs_dir: docs",
    "assets_dir: assets",
    "summary: SUMMARY.md",
    "redirects: redirects.yaml",
    "",
    "checks:",
    "  warn_only:",
    "    - image-alt",
    "    - orphan-pages",
    "    - deprecated-links",
    "    - absolute-links",
    "",
    "  # Release notes legitimately reference deprecated features",
    "  deprecated-links:",
    "    exclude_files:",
    "      - overview/release-notes.md",
    "",
  ].join("\n");
  await writeText(join(target, "docs-lint.yaml"), aidboxLintConfig);
  ok("docs-lint.yaml updated");

  // 9. Run lint
  await runLint(target);
}

async function migrateAuditbox(): Promise<void> {
  log(`\n${BOLD}=== Migrating Auditbox ===${RESET}`);

  const srcDocs = join(DOCS_ROOT, "docs-new/auditbox/docs");
  const srcAssetsRoot = join(DOCS_ROOT, ".gitbook/assets/auditbox");
  const srcAssetsLocal = join(DOCS_ROOT, "docs-new/auditbox/.gitbook/assets");
  const srcGitbook = join(DOCS_ROOT, "docs-new/auditbox/.gitbook.yaml");
  const target = join(REPOS_ROOT, "auditbox-docs");

  if (!(await Bun.file(join(srcDocs, "SUMMARY.md")).exists())) {
    fail(`Source docs not found: ${srcDocs}`);
    return;
  }

  if (!(await dirExists(target))) {
    fail(`Target repo not found: ${target}. Clone it first.`);
    return;
  }

  // 1. Clean
  info("Cleaning target docs/ and assets/...");
  await cleanDir(join(target, "docs"));
  await cleanDir(join(target, "assets"));

  // 2. Copy docs
  info("Copying docs...");
  const mdFiles = await globFiles(srcDocs, "**/*.md");
  let docCount = 0;
  for (const file of mdFiles) {
    const srcPath = join(srcDocs, file);
    const dstPath = join(target, "docs", file);
    if (!DRY_RUN) {
      await mkdirp(dirname(dstPath));
      await Bun.write(dstPath, Bun.file(srcPath));
    }
    docCount++;
  }
  ok(`Copied ${docCount} markdown files`);

  // 3. Copy assets from root .gitbook/assets/auditbox/ (stripping auditbox/ prefix)
  info("Copying assets...");
  let assetCount = 0;
  if (await dirExists(srcAssetsRoot)) {
    const rootAssets = await globFiles(srcAssetsRoot, "**/*");
    for (const file of rootAssets) {
      const srcPath = join(srcAssetsRoot, file);
      const f = Bun.file(srcPath);
      if (await f.exists()) {
        const dstPath = join(target, "assets", file);
        if (!DRY_RUN) {
          await mkdirp(dirname(dstPath));
          await Bun.write(dstPath, f);
        }
        assetCount++;
      }
    }
  }

  // Also copy from local .gitbook/assets/ (non-auditbox subfolder items)
  const localAssets = await globFiles(srcAssetsLocal, "**/*").catch(() => []);
  for (const file of localAssets) {
    if (file === "auditbox") continue; // skip subdirectory
    const srcPath = join(srcAssetsLocal, file);
    const f = Bun.file(srcPath);
    if (await f.exists()) {
      const dstPath = join(target, "assets", file);
      if (!DRY_RUN) {
        await mkdirp(dirname(dstPath));
        await Bun.write(dstPath, f);
      }
      assetCount++;
    }
  }
  ok(`Copied ${assetCount} assets`);

  // 4. SUMMARY.md
  info("Copying SUMMARY.md...");
  const summaryContent = await readText(join(srcDocs, "SUMMARY.md"));
  if (summaryContent) {
    await writeText(join(target, "SUMMARY.md"), summaryContent);
    ok("SUMMARY.md copied");
  }

  // 5. Redirects
  info("Converting redirects...");
  const redirectsYaml = await convertRedirects(srcGitbook);
  await writeText(join(target, "redirects.yaml"), redirectsYaml);
  ok("redirects.yaml generated");

  // 6. Rewrite image paths (strip auditbox/ prefix from asset references)
  info("Rewriting image paths...");
  let rewriteCount = 0;
  const targetMdFiles = await globFiles(join(target, "docs"), "**/*.md");
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    const rewritten = rewriteImagePaths(content, file, {
      stripAssetPrefix: "auditbox/",
    });
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      rewriteCount++;
    }
  }
  ok(`Rewrote image paths in ${rewriteCount} files`);

  await runLint(target);
}

async function migrateFormbox(): Promise<void> {
  log(`\n${BOLD}=== Migrating Formbox ===${RESET}`);

  const srcForms = join(DOCS_ROOT, "docs/modules/aidbox-forms");
  const srcRef = join(DOCS_ROOT, "docs/reference/aidbox-forms-reference");
  const srcAssets = join(DOCS_ROOT, "docs/.gitbook/assets");
  const srcSummary = join(DOCS_ROOT, "docs/SUMMARY.md");
  const target = join(REPOS_ROOT, "formbox-docs");

  if (!(await Bun.file(join(srcForms, "README.md")).exists())) {
    fail(`Source forms docs not found: ${srcForms}`);
    return;
  }

  if (!(await dirExists(target))) {
    fail(`Target repo not found: ${target}. Clone it first.`);
    return;
  }

  // 1. Clean
  info("Cleaning target docs/ and assets/...");
  await cleanDir(join(target, "docs"));
  await cleanDir(join(target, "assets"));

  // 2. Copy forms docs (flatten: modules/aidbox-forms/* -> docs/*)
  info("Copying forms docs...");
  let docCount = 0;
  const formsFiles = await globFiles(srcForms, "**/*.md");
  for (const file of formsFiles) {
    const srcPath = join(srcForms, file);
    const dstPath = join(target, "docs", file);
    if (!DRY_RUN) {
      await mkdirp(dirname(dstPath));
      await Bun.write(dstPath, Bun.file(srcPath));
    }
    docCount++;
  }

  // Copy reference docs
  const refFiles = await globFiles(srcRef, "**/*.md");
  for (const file of refFiles) {
    const srcPath = join(srcRef, file);
    const dstPath = join(target, "docs/reference", file);
    if (!DRY_RUN) {
      await mkdirp(dirname(dstPath));
      await Bun.write(dstPath, Bun.file(srcPath));
    }
    docCount++;
  }
  ok(`Copied ${docCount} markdown files`);

  // 3. Generate SUMMARY.md from aidbox SUMMARY
  info("Generating SUMMARY.md...");
  const fullSummary = await readText(srcSummary);
  if (fullSummary) {
    const formboxSummary = extractFormboxSummary(fullSummary);
    await writeText(join(target, "SUMMARY.md"), formboxSummary);
    ok("SUMMARY.md generated");
  }

  // 4. Empty redirects for now
  await writeText(join(target, "redirects.yaml"), "redirects: {}\n");
  ok("redirects.yaml created (empty)");

  // 5. Rewrite image paths first (so we can find referenced images)
  info("Rewriting image paths...");
  let rewriteCount = 0;
  const targetMdFiles = await globFiles(join(target, "docs"), "**/*.md");
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    const rewritten = rewriteImagePaths(content, file);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      rewriteCount++;
    }
  }
  ok(`Rewrote image paths in ${rewriteCount} files`);

  // 6. Copy only referenced images
  info("Copying referenced assets...");
  const referencedImages = await findReferencedImages(join(target, "docs"));
  let assetCount = 0;
  for (const imageName of referencedImages) {
    const srcPath = join(srcAssets, imageName);
    const f = Bun.file(srcPath);
    if (await f.exists()) {
      const dstPath = join(target, "assets", imageName);
      if (!DRY_RUN) {
        await mkdirp(dirname(dstPath));
        await Bun.write(dstPath, f);
      }
      assetCount++;
    } else {
      warn(`Referenced image not found: ${imageName}`);
    }
  }
  ok(`Copied ${assetCount} referenced assets`);

  // 7. Rewrite cross-links to aidbox as external
  info("Rewriting cross-links to external URLs...");
  const formboxPaths = new Set(
    (await globFiles(join(target, "docs"), "**/*.md")).map((f) =>
      f.replace(/\.md$/, ""),
    ),
  );

  let crossLinkCount = 0;
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    // Files from reference/ originally lived at reference/aidbox-forms-reference/
    // Files from other dirs originally lived at modules/aidbox-forms/
    const srcPrefix = file.startsWith("reference/")
      ? "reference/aidbox-forms-reference"
      : "modules/aidbox-forms";
    let rewritten = rewriteExternalLinks(content, file, formboxPaths, [
      { from: "reference/aidbox-forms-reference/", to: "reference/" },
      { from: "modules/aidbox-forms/", to: "" },
    ], srcPrefix);
    rewritten = rewriteDocsAidboxDomain(rewritten);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      crossLinkCount++;
    }
  }
  ok(`Rewrote cross-links in ${crossLinkCount} files`);

  // 8. Update docs-lint.yaml — absolute links to aidbox are legitimate cross-product refs
  info("Updating docs-lint.yaml...");
  const lintConfig = [
    "docs_dir: docs",
    "assets_dir: assets",
    "summary: SUMMARY.md",
    "",
    "checks:",
    "  warn_only:",
    "    - title-mismatch",
    "    - absolute-links",
    "",
  ].join("\n");
  await writeText(join(target, "docs-lint.yaml"), lintConfig);
  ok("docs-lint.yaml updated");

  await runLint(target);
}

// ---------------------------------------------------------------------------
// Generic module migration (erxbox, mdmbox, etc.)
// ---------------------------------------------------------------------------

/**
 * Migrate a single module from aidbox docs into its own repo.
 * Source: documentation/docs/modules/{modulePath}/
 * Target: {targetRepo}/docs/
 */
async function migrateModule(opts: {
  name: string;
  modulePath: string;
  targetRepo: string;
  summarySection: string; // prefix to match in SUMMARY.md, e.g. "modules/eprescription/"
}): Promise<void> {
  log(`\n${BOLD}=== Migrating ${opts.name} ===${RESET}`);

  const srcModule = join(DOCS_ROOT, "docs/modules", opts.modulePath);
  const srcAssets = join(DOCS_ROOT, "docs/.gitbook/assets");
  const srcAssetsRoot = join(DOCS_ROOT, ".gitbook/assets");
  const srcSummary = join(DOCS_ROOT, "docs/SUMMARY.md");
  const target = opts.targetRepo;

  if (!(await dirExists(srcModule))) {
    fail(`Source module not found: ${srcModule}`);
    return;
  }

  if (!(await dirExists(target))) {
    fail(`Target repo not found: ${target}. Clone it first.`);
    return;
  }

  // 1. Clean
  info("Cleaning target docs/ and assets/...");
  await cleanDir(join(target, "docs"));
  await cleanDir(join(target, "assets"));

  // 2. Copy module docs (flatten: modules/X/* -> docs/*)
  info("Copying docs...");
  let docCount = 0;
  const moduleFiles = await globFiles(srcModule, "**/*.md");
  for (const file of moduleFiles) {
    const srcPath = join(srcModule, file);
    const dstPath = join(target, "docs", file);
    if (!DRY_RUN) {
      await mkdirp(dirname(dstPath));
      await Bun.write(dstPath, Bun.file(srcPath));
    }
    docCount++;
  }
  ok(`Copied ${docCount} markdown files`);

  // 3. Generate SUMMARY.md by extracting the module section
  info("Generating SUMMARY.md...");
  const fullSummary = await readText(srcSummary);
  if (fullSummary) {
    const moduleSummary = extractModuleSummary(
      fullSummary,
      opts.summarySection,
    );
    await writeText(join(target, "SUMMARY.md"), moduleSummary);
    ok("SUMMARY.md generated");
  }

  // 4. Empty redirects
  await writeText(join(target, "redirects.yaml"), "redirects: {}\n");
  ok("redirects.yaml created (empty)");

  // 5. Rewrite image paths
  info("Rewriting image paths...");
  let rewriteCount = 0;
  const targetMdFiles = await globFiles(join(target, "docs"), "**/*.md");
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    const rewritten = rewriteImagePaths(content, file);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      rewriteCount++;
    }
  }
  ok(`Rewrote image paths in ${rewriteCount} files`);

  // 6. Copy only referenced images
  info("Copying referenced assets...");
  const referencedImages = await findReferencedImages(join(target, "docs"));
  let assetCount = 0;
  for (const imageName of referencedImages) {
    // Try docs/.gitbook/assets/ first, then root .gitbook/assets/
    let found = false;
    for (const assetsDir of [srcAssets, srcAssetsRoot]) {
      const srcPath = join(assetsDir, imageName);
      const f = Bun.file(srcPath);
      if (await f.exists()) {
        const dstPath = join(target, "assets", imageName);
        if (!DRY_RUN) {
          await mkdirp(dirname(dstPath));
          await Bun.write(dstPath, f);
        }
        assetCount++;
        found = true;
        break;
      }
    }
    if (!found) {
      warn(`Referenced image not found: ${imageName}`);
    }
  }
  ok(`Copied ${assetCount} referenced assets`);

  // 7. Rewrite cross-links to aidbox as external
  info("Rewriting cross-links to external URLs...");
  const modulePaths = new Set(
    (await globFiles(join(target, "docs"), "**/*.md")).map((f) =>
      f.replace(/\.md$/, ""),
    ),
  );

  let crossLinkCount = 0;
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    let rewritten = rewriteExternalLinks(content, file, modulePaths, [], "modules/" + opts.modulePath);
    rewritten = rewriteDocsAidboxDomain(rewritten);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      crossLinkCount++;
    }
  }
  ok(`Rewrote cross-links in ${crossLinkCount} files`);

  // 8. Update docs-lint.yaml — absolute links to aidbox are legitimate cross-product refs
  info("Updating docs-lint.yaml...");
  const lintConfig = [
    "docs_dir: docs",
    "assets_dir: assets",
    "summary: SUMMARY.md",
    "",
    "checks:",
    "  warn_only:",
    "    - title-mismatch",
    "    - absolute-links",
    "",
  ].join("\n");
  await writeText(join(target, "docs-lint.yaml"), lintConfig);
  ok("docs-lint.yaml updated");

  await runLint(target);
}

/**
 * Extract a module section from SUMMARY.md.
 * Finds lines matching the sectionPrefix, captures the block,
 * strips the prefix, and de-indents.
 */
function extractModuleSummary(
  fullSummary: string,
  sectionPrefix: string,
): string {
  const lines = fullSummary.split("\n");
  const sectionLines: string[] = [];
  let inSection = false;
  let sectionIndent = -1;

  for (const line of lines) {
    if (line.includes(sectionPrefix)) {
      if (!inSection) {
        inSection = true;
        sectionIndent = line.search(/\S/);
      }
      sectionLines.push(line);
      continue;
    }

    if (inSection) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      const indent = line.search(/\S/);
      if (indent <= sectionIndent) {
        inSection = false;
      } else {
        sectionLines.push(line);
        continue;
      }
    }
  }

  // Strip module path prefix and de-indent
  const minIndent = sectionLines
    .filter((l) => l.trim())
    .reduce((min, l) => Math.min(min, l.search(/\S/)), Infinity);

  const processed = sectionLines.map((line) => {
    if (!line.trim()) return "";
    const deindented = line.slice(Math.min(minIndent, line.search(/\S/)));
    return deindented.replace(new RegExp(escapeRegex(sectionPrefix), "g"), "");
  });

  return ["# Table of contents", "", ...processed, ""].join("\n");
}

// ---------------------------------------------------------------------------
// Smartbox migration (solutions section)
// ---------------------------------------------------------------------------

async function migrateSmartbox(): Promise<void> {
  log(`\n${BOLD}=== Migrating Smartbox ===${RESET}`);

  const srcSolutions = join(DOCS_ROOT, "docs/solutions");
  const srcAssets = join(DOCS_ROOT, "docs/.gitbook/assets");
  const srcAssetsRoot = join(DOCS_ROOT, ".gitbook/assets");
  const srcSummary = join(DOCS_ROOT, "docs/SUMMARY.md");
  const target = join(REPOS_ROOT, "smartbox-docs");

  if (!(await dirExists(srcSolutions))) {
    fail(`Source solutions not found: ${srcSolutions}`);
    return;
  }

  if (!(await dirExists(target))) {
    fail(`Target repo not found: ${target}. Clone it first.`);
    return;
  }

  // 1. Clean
  info("Cleaning target docs/ and assets/...");
  await cleanDir(join(target, "docs"));
  await cleanDir(join(target, "assets"));

  // 2. Copy solutions docs (flatten: solutions/* -> docs/*)
  info("Copying docs...");
  let docCount = 0;
  const solutionFiles = await globFiles(srcSolutions, "**/*.md");
  for (const file of solutionFiles) {
    const srcPath = join(srcSolutions, file);
    const dstPath = join(target, "docs", file);
    if (!DRY_RUN) {
      await mkdirp(dirname(dstPath));
      await Bun.write(dstPath, Bun.file(srcPath));
    }
    docCount++;
  }
  ok(`Copied ${docCount} markdown files`);

  // 3. Generate SUMMARY.md by extracting the solutions section
  info("Generating SUMMARY.md...");
  const fullSummary = await readText(srcSummary);
  if (fullSummary) {
    const smartboxSummary = extractModuleSummary(fullSummary, "solutions/");
    await writeText(join(target, "SUMMARY.md"), smartboxSummary);
    ok("SUMMARY.md generated");
  }

  // 4. Empty redirects
  await writeText(join(target, "redirects.yaml"), "redirects: {}\n");
  ok("redirects.yaml created (empty)");

  // 5. Rewrite image paths
  info("Rewriting image paths...");
  let rewriteCount = 0;
  const targetMdFiles = await globFiles(join(target, "docs"), "**/*.md");
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    const rewritten = rewriteImagePaths(content, file);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      rewriteCount++;
    }
  }
  ok(`Rewrote image paths in ${rewriteCount} files`);

  // 6. Copy only referenced images
  info("Copying referenced assets...");
  const referencedImages = await findReferencedImages(join(target, "docs"));
  let assetCount = 0;
  for (const imageName of referencedImages) {
    let found = false;
    for (const assetsDir of [srcAssets, srcAssetsRoot]) {
      const srcPath = join(assetsDir, imageName);
      const f = Bun.file(srcPath);
      if (await f.exists()) {
        const dstPath = join(target, "assets", imageName);
        if (!DRY_RUN) {
          await mkdirp(dirname(dstPath));
          await Bun.write(dstPath, f);
        }
        assetCount++;
        found = true;
        break;
      }
    }
    if (!found) {
      warn(`Referenced image not found: ${imageName}`);
    }
  }
  ok(`Copied ${assetCount} referenced assets`);

  // 7. Rewrite cross-links to aidbox as external
  info("Rewriting cross-links to external URLs...");
  const smartboxPaths = new Set(
    (await globFiles(join(target, "docs"), "**/*.md")).map((f) =>
      f.replace(/\.md$/, ""),
    ),
  );

  let crossLinkCount = 0;
  for (const file of targetMdFiles) {
    const filePath = join(target, "docs", file);
    const content = await readText(filePath);
    if (!content) continue;

    let rewritten = rewriteExternalLinks(content, file, smartboxPaths, [], "solutions");
    rewritten = rewriteDocsAidboxDomain(rewritten);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      crossLinkCount++;
    }
  }
  ok(`Rewrote cross-links in ${crossLinkCount} files`);

  // 8. Update docs-lint.yaml
  info("Updating docs-lint.yaml...");
  const lintConfig = [
    "docs_dir: docs",
    "assets_dir: assets",
    "summary: SUMMARY.md",
    "",
    "checks:",
    "  warn_only:",
    "    - title-mismatch",
    "    - absolute-links",
    "",
  ].join("\n");
  await writeText(join(target, "docs-lint.yaml"), lintConfig);
  ok("docs-lint.yaml updated");

  await runLint(target);
}

// ---------------------------------------------------------------------------
// Lint runner
// ---------------------------------------------------------------------------

async function runLint(repoDir: string): Promise<void> {
  info("Running docs-lint...");
  const cliPath = join(import.meta.dir, "../src/cli.ts");
  const proc = Bun.spawn(["bun", cliPath], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  // Count issues from output
  const errorMatch = stdout.match(/(\d+) check\(s\) failed/);
  const warnMatch = stdout.match(/(\d+) warning\(s\)/);

  if (exitCode === 0) {
    ok("Lint passed");
  } else {
    const errors = errorMatch ? errorMatch[1] : "?";
    const warnings = warnMatch ? warnMatch[1] : "0";
    warn(`Lint: ${errors} error(s), ${warnings} warning(s)`);
    // Print summary lines
    const lines = stdout.split("\n");
    for (const line of lines) {
      if (line.includes("\u2717") || line.includes("\u26A0")) {
        console.log(`    ${line.trim()}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log(`${BOLD}Documentation Migration${RESET}`);
  log(`Source: ${DOCS_ROOT}`);
  log(`Target repos: ${REPOS_ROOT}`);
  if (DRY_RUN) log(`${YELLOW}DRY RUN — no files will be written${RESET}`);

  // Verify source exists
  if (!(await Bun.file(join(DOCS_ROOT, ".gitbook.yaml")).exists())) {
    fail(`Documentation repo not found at ${DOCS_ROOT}`);
    process.exit(1);
  }

  const products = ONLY_PRODUCT === "all"
    ? ["aidbox", "auditbox", "formbox", "erxbox", "mdmbox", "smartbox"]
    : [ONLY_PRODUCT];

  for (const product of products) {
    switch (product) {
      case "aidbox":
        await migrateAidbox();
        break;
      case "auditbox":
        await migrateAuditbox();
        break;
      case "formbox":
        await migrateFormbox();
        break;
      case "erxbox":
        await migrateModule({
          name: "eRxBox",
          modulePath: "eprescription",
          targetRepo: join(REPOS_ROOT, "erxbox-docs"),
          summarySection: "modules/eprescription/",
        });
        break;
      case "mdmbox":
        await migrateModule({
          name: "MDMBox",
          modulePath: "mdm",
          targetRepo: join(REPOS_ROOT, "mdmbox-docs"),
          summarySection: "modules/mdm/",
        });
        break;
      case "smartbox":
        await migrateSmartbox();
        break;
      default:
        fail(`Unknown product: ${product}`);
    }
  }

  log(`\n${BOLD}Done.${RESET}`);
}

main();
