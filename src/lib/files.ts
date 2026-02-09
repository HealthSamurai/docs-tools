import { join, relative } from "path";
import { Glob } from "bun";

/**
 * Get all markdown files in docsDir, excluding directories in `exclude`.
 * Returns paths relative to docsDir.
 */
export async function getMarkdownFiles(
  docsDir: string,
  exclude: string[] = [],
): Promise<string[]> {
  const glob = new Glob("**/*.md");
  const files: string[] = [];

  for await (const path of glob.scan({ cwd: docsDir, absolute: false })) {
    const shouldExclude = exclude.some((ex) => {
      const parts = path.split("/");
      return parts.includes(ex);
    });
    if (!shouldExclude) {
      files.push(path);
    }
  }

  return files.sort();
}

/**
 * Read file content, returns null if file doesn't exist.
 */
export async function readFile(path: string): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return file.text();
}

/**
 * Check if a file exists.
 */
export async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}
