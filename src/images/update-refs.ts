import { Glob } from "bun";
import { join } from "path";

interface Rename {
  from: string;
  to: string;
}

/**
 * Update image references in all markdown files in a directory.
 * Replaces old image filenames with new ones (e.g., .png -> .webp).
 */
export async function updateRefsInDir(
  docsDir: string,
  renames: Rename[],
): Promise<number> {
  let updatedFiles = 0;
  const glob = new Glob("**/*.md");

  for await (const path of glob.scan({ cwd: docsDir, absolute: false })) {
    const fullPath = join(docsDir, path);
    const file = Bun.file(fullPath);
    let content = await file.text();
    let changed = false;

    for (const rename of renames) {
      // Replace both the exact filename and URL-encoded variants
      const fromBasename = rename.from.split("/").pop()!;
      const toBasename = rename.to.split("/").pop()!;
      const fromEncoded = encodeURIComponent(fromBasename).replace(/%20/g, " ");

      if (content.includes(fromBasename)) {
        content = content.replaceAll(fromBasename, toBasename);
        changed = true;
      }
      if (fromEncoded !== fromBasename && content.includes(fromEncoded)) {
        content = content.replaceAll(
          fromEncoded,
          encodeURIComponent(toBasename).replace(/%20/g, " "),
        );
        changed = true;
      }
    }

    if (changed) {
      await Bun.write(fullPath, content);
      updatedFiles++;
    }
  }

  if (updatedFiles > 0) {
    console.log(`  Updated references in ${updatedFiles} file(s)`);
  }

  return updatedFiles;
}
