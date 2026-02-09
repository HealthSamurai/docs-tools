#!/usr/bin/env bun
/**
 * Installs git hooks for docs-tools.
 * Runs automatically via "prepare" script on `bun install`.
 */
import { join } from "path";
import { mkdir } from "fs/promises";

const root = process.cwd();
const hooksDir = join(root, ".git", "hooks");

// Skip if not a git repo (e.g. during CI checkout of docs-tools itself)
const gitDir = Bun.file(join(root, ".git"));
if (!(await gitDir.exists())) process.exit(0);

await mkdir(hooksDir, { recursive: true });

const hookPath = join(hooksDir, "pre-push");
const hookContent = `#!/bin/sh
# docs-tools pre-push hook — runs all lint checks before push
bun lint
`;

await Bun.write(hookPath, hookContent);
Bun.spawn(["chmod", "+x", hookPath]);
