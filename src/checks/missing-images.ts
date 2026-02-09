import { join, dirname, normalize } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { contentLines } from "../lib/markdown";
import { readFile, fileExists } from "../lib/files";

const IMAGE_EXTENSIONS = /\.(png|jpg|jpeg|gif|svg|webp|bmp|tiff)$/i;

interface ImageRef {
  path: string;
  lineNum: number;
}

/**
 * Extract image references from markdown content.
 */
function extractImageRefs(content: string): ImageRef[] {
  const refs: ImageRef[] = [];

  for (const { line, lineNum } of contentLines(content)) {
    // Markdown images: ![alt](path)
    const mdPattern = /!\[[^\]]*\]\(([^)]+)\)/g;
    let match;
    while ((match = mdPattern.exec(line)) !== null) {
      const path = match[1].split("#")[0].trim();
      if (path && !path.startsWith("http") && IMAGE_EXTENSIONS.test(path)) {
        refs.push({ path, lineNum });
      }
    }

    // HTML img src: <img src="path">
    const srcPattern = /src=["']([^"']+)["']/gi;
    while ((match = srcPattern.exec(line)) !== null) {
      const path = match[1].trim();
      if (path && !path.startsWith("http") && IMAGE_EXTENSIONS.test(path)) {
        refs.push({ path, lineNum });
      }
    }
  }

  return refs;
}

/**
 * Try to find an image file using various path resolution strategies.
 */
async function imageExists(
  docsDir: string,
  assetsDir: string,
  sourceFile: string,
  imagePath: string,
): Promise<boolean> {
  const decoded = decodeURIComponent(imagePath);
  const sourceDir = dirname(join(docsDir, sourceFile));

  // Try relative to source file
  const relativePath = normalize(join(sourceDir, decoded));
  if (await fileExists(relativePath)) return true;

  // Try relative to assets dir
  const filename = decoded.split("/").pop()!;
  if (await fileExists(join(assetsDir, filename))) return true;

  // Try with URL decoding on the full path
  const decodedFull = normalize(join(sourceDir, imagePath.replace(/%20/g, " ")));
  if (decodedFull !== relativePath && (await fileExists(decodedFull))) return true;

  return false;
}

export const missingImages: Check = {
  id: "missing-images",
  name: "Missing Images",
  severity: "error",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const issues: Issue[] = [];
    let totalImages = 0;

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      const refs = extractImageRefs(content);
      totalImages += refs.length;

      for (const ref of refs) {
        const exists = await imageExists(
          ctx.docsDir,
          ctx.assetsDir,
          file,
          ref.path,
        );
        if (!exists) {
          issues.push({
            file,
            line: ref.lineNum,
            message: `Missing image: ${ref.path}`,
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
