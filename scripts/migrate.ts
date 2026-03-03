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
  await Bun.write(join(dir, ".gitkeep"), ""); // ensure dir exists
  const proc2 = Bun.spawn(["rm", join(dir, ".gitkeep")], {
    stdout: "ignore",
    stderr: "ignore",
  });
  await proc2.exited;
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
function rewriteImagePaths(
  content: string,
  opts?: { stripAssetPrefix?: string },
): string {
  const prefix = opts?.stripAssetPrefix
    ? opts.stripAssetPrefix.replace(/\/$/, "") + "/"
    : "";

  // Handle both markdown and HTML image references
  // Matches: (../../).gitbook/assets/[prefix]file.png
  const pattern = new RegExp(
    `((?:\\.\\.\\/)*)\\.gitbook\\/assets\\/${escapeRegex(prefix)}`,
    "g",
  );

  return content.replace(pattern, "$1../assets/");
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
 * Rewrite internal links that point outside of formbox content
 * to external links to docs.aidbox.app.
 */
function rewriteExternalLinks(
  content: string,
  formboxPaths: Set<string>,
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
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(href)) return match;

    // Strip anchor
    const cleanHref = href.split("#")[0];
    if (!cleanHref) return match;

    // Relative paths that go up beyond formbox root (../../) likely point to aidbox
    if (cleanHref.startsWith("../../") || cleanHref.startsWith("../../../")) {
      // Resolve to aidbox path
      const aidboxPath = cleanHref
        .replace(/^(\.\.\/)+/, "")
        .replace(/\.md$/, "")
        .replace(/\/README$/, "");
      return `${text}(https://docs.aidbox.app/docs/aidbox/${aidboxPath})`;
    }

    return match;
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

    // Match .gitbook/assets/FILENAME patterns
    const pattern = /\.gitbook\/assets\/([^\s"')<>]+)/g;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      images.add(match[1]);
    }

    // Also match assets/FILENAME (already rewritten)
    const pattern2 = /(?:\.\.\/)+assets\/([^\s"')<>]+)/g;
    while ((match = pattern2.exec(content)) !== null) {
      images.add(match[1]);
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

    const rewritten = rewriteImagePaths(content);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      rewriteCount++;
    }
  }
  ok(`Rewrote image paths in ${rewriteCount} files`);

  // 7. Run lint
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
  if (await Bun.file(join(srcAssetsRoot, ".")).exists().catch(() => false) || true) {
    const rootAssets = await globFiles(srcAssetsRoot, "**/*").catch(() => []);
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
  const localAssets = await globFiles(srcAssetsLocal, "*").catch(() => []);
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

    const rewritten = rewriteImagePaths(content, {
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

    // Forms docs are nested deeper, so they have more ../
    // The pattern still works: replace .gitbook/assets/ with ../assets/
    const rewritten = rewriteImagePaths(content);
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

    const rewritten = rewriteExternalLinks(content, formboxPaths);
    if (rewritten !== content) {
      await writeText(filePath, rewritten);
      crossLinkCount++;
    }
  }
  ok(`Rewrote cross-links in ${crossLinkCount} files`);

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
    ? ["aidbox", "auditbox", "formbox"]
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
      default:
        fail(`Unknown product: ${product}`);
    }
  }

  log(`\n${BOLD}Done.${RESET}`);
}

main();
