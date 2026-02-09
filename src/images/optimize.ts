import { Glob } from "bun";
import { join, basename, extname } from "path";
import { stat, unlink } from "fs/promises";
import { updateRefsInDir } from "./update-refs";

const OPTIMIZABLE_EXTENSIONS = ["png", "jpg", "jpeg", "gif"];

interface OptimizeOptions {
  dryRun: boolean;
  keepOriginals: boolean;
  quality: number;
  maxWidth: number;
}

interface ConversionResult {
  source: string;
  dest: string;
  originalSize: number;
  newSize: number;
}

export async function optimizeImages(
  assetsDir: string,
  docsDir: string,
  options: OptimizeOptions,
): Promise<void> {
  let sharp: typeof import("sharp");
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error(
      "Error: sharp is not installed. Run: bun add sharp",
    );
    process.exit(1);
  }

  const files: string[] = [];

  for (const ext of OPTIMIZABLE_EXTENSIONS) {
    const glob = new Glob(`**/*.${ext}`);
    for await (const path of glob.scan({ cwd: assetsDir, absolute: false })) {
      files.push(path);
    }
  }

  if (files.length === 0) {
    console.log("No images to optimize");
    return;
  }

  console.log(`Found ${files.length} images to optimize\n`);

  const results: ConversionResult[] = [];
  const renames: Array<{ from: string; to: string }> = [];

  for (const file of files) {
    const fullPath = join(assetsDir, file);
    const info = await stat(fullPath);
    const ext = extname(file);
    const webpPath = file.slice(0, -ext.length) + ".webp";
    const webpFullPath = join(assetsDir, webpPath);

    if (options.dryRun) {
      console.log(`  Would convert: ${file} -> ${webpPath}`);
      renames.push({ from: file, to: webpPath });
      continue;
    }

    try {
      let pipeline = sharp(fullPath);

      // Get metadata for resize check
      const metadata = await pipeline.metadata();
      if (metadata.width && metadata.width > options.maxWidth) {
        pipeline = pipeline.resize(options.maxWidth);
      }

      await pipeline.webp({ quality: options.quality }).toFile(webpFullPath);

      const newInfo = await stat(webpFullPath);
      const savings = ((1 - newInfo.size / info.size) * 100).toFixed(0);

      results.push({
        source: file,
        dest: webpPath,
        originalSize: info.size,
        newSize: newInfo.size,
      });

      console.log(
        `  ${file} -> ${webpPath} (${formatSize(info.size)} -> ${formatSize(newInfo.size)}, -${savings}%)`,
      );

      renames.push({ from: file, to: webpPath });

      if (!options.keepOriginals) {
        await unlink(fullPath);
      }
    } catch (e) {
      console.error(`  Error converting ${file}: ${e}`);
    }
  }

  // Update markdown references
  if (renames.length > 0) {
    if (options.dryRun) {
      console.log(`\nWould update references in ${docsDir}/`);
    } else {
      console.log(`\nUpdating markdown references...`);
      await updateRefsInDir(docsDir, renames);
    }
  }

  if (!options.dryRun && results.length > 0) {
    const totalOriginal = results.reduce((s, r) => s + r.originalSize, 0);
    const totalNew = results.reduce((s, r) => s + r.newSize, 0);
    const totalSavings = ((1 - totalNew / totalOriginal) * 100).toFixed(0);

    console.log(
      `\nDone: ${results.length} images converted (${formatSize(totalOriginal)} -> ${formatSize(totalNew)}, -${totalSavings}%)`,
    );
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
