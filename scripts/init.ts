#!/usr/bin/env bun
/**
 * Initialize a docs repository for use with docs-tools.
 *
 * Usage:
 *   cd ~/dev/hs/docs-repos/aidbox-docs
 *   bun ~/dev/hs/docs-tools/scripts/init.ts
 *
 * What it does:
 *   1. Creates package.json with lint/images/og scripts
 *   2. Installs docs-tools from GitHub
 *   3. Installs pre-push git hook
 *   4. Creates .github/workflows/docs.yml
 */

import { join, basename } from "path";
import { mkdir } from "fs/promises";

const root = process.cwd();
const repoName = basename(root);

// --- 1. package.json ---

const pkgPath = join(root, "package.json");
const existingPkg = await Bun.file(pkgPath).exists()
  ? JSON.parse(await Bun.file(pkgPath).text())
  : {};

const pkg = {
  ...existingPkg,
  name: existingPkg.name ?? repoName,
  private: true,
  scripts: {
    ...(existingPkg.scripts ?? {}),
    postinstall: "install-hooks",
    lint: "docs-lint",
    "lint:check": "docs-lint --check",
    "lint:json": "docs-lint --json",
    "images:check": "docs-images check",
    "images:optimize": "docs-images optimize",
    "images:dry-run": "docs-images optimize --dry-run",
    "og:generate": "docs-og generate",
    "og:dry-run": "docs-og generate --dry-run",
    "og:diff": "docs-og generate --diff",
  },
  devDependencies: {
    ...(existingPkg.devDependencies ?? {}),
    "docs-tools": "github:HealthSamurai/docs-tools",
  },
};

await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("✓ package.json");

// --- 2. bun install ---

const install = Bun.spawn(["bun", "install"], {
  cwd: root,
  stdout: "pipe",
  stderr: "pipe",
});
await install.exited;
console.log("✓ bun install (docs-tools from GitHub)");

// --- 3. Pre-push hook ---

const gitDir = join(root, ".git");
const hooksDir = join(gitDir, "hooks");
await mkdir(hooksDir, { recursive: true });

const hookPath = join(hooksDir, "pre-push");
const hookContent = `#!/bin/sh
# docs-tools pre-push hook — runs all lint checks before push
bun lint
`;

await Bun.write(hookPath, hookContent);
const chmod = Bun.spawn(["chmod", "+x", hookPath]);
await chmod.exited;
console.log("✓ pre-push hook installed");

// --- 4. GitHub Actions workflow ---

const workflowDir = join(root, ".github", "workflows");
await mkdir(workflowDir, { recursive: true });

const productName = repoName.replace("-docs", "");

const workflow = `name: docs

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install
      - run: bun lint

  images:
    runs-on: ubuntu-latest
    if: github.event_name == 'push' && github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: latest

      - run: bun install
      - run: bun images:optimize
      - run: bun og:generate

      - name: Commit optimized assets
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add assets/ docs/
          git diff --cached --quiet || git commit -m "chore: optimize images + generate OG previews"
          git push
`;

await Bun.write(join(workflowDir, "docs.yml"), workflow);
console.log("✓ .github/workflows/docs.yml");

// --- 5. .gitignore additions ---

const gitignorePath = join(root, ".gitignore");
const gitignoreFile = Bun.file(gitignorePath);
const existingGitignore = (await gitignoreFile.exists())
  ? await gitignoreFile.text()
  : "";

const additions = ["node_modules/", ".docs-tools/"];
const missing = additions.filter((a) => !existingGitignore.includes(a));

if (missing.length > 0) {
  const newContent =
    existingGitignore.trimEnd() + "\n\n# docs-tools\n" + missing.join("\n") + "\n";
  await Bun.write(gitignorePath, newContent);
  console.log("✓ .gitignore updated");
}

console.log(`\nDone! Now you can run:
  bun lint              — run all checks
  bun lint:check <id>   — run single check (e.g. bun lint:check broken-links)
  bun images:check      — find unoptimized images
  bun images:optimize   — convert to WebP
  bun og:generate       — generate OG images
`);
