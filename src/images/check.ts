import { Glob } from "bun";
import { join } from "path";
import { stat } from "fs/promises";

const HEAVY_THRESHOLD = 500 * 1024; // 500KB
const OPTIMIZABLE_EXTENSIONS = ["png", "jpg", "jpeg", "gif"];

interface UnoptimizedImage {
  path: string;
  size: number;
  reason: string;
}

export async function checkUnoptimized(assetsDir: string): Promise<void> {
  const results: UnoptimizedImage[] = [];
  let totalFiles = 0;

  for (const ext of OPTIMIZABLE_EXTENSIONS) {
    const glob = new Glob(`**/*.${ext}`);
    for await (const path of glob.scan({ cwd: assetsDir, absolute: false })) {
      totalFiles++;
      const fullPath = join(assetsDir, path);
      const info = await stat(fullPath);

      if (info.size > HEAVY_THRESHOLD) {
        results.push({
          path,
          size: info.size,
          reason: `${formatSize(info.size)} (>500KB)`,
        });
      } else {
        results.push({
          path,
          size: info.size,
          reason: `Not WebP`,
        });
      }
    }
  }

  if (results.length === 0) {
    console.log(`\u2713 ${totalFiles} images checked, all optimized`);
    return;
  }

  // Sort by size descending
  results.sort((a, b) => b.size - a.size);

  const heavy = results.filter((r) => r.size > HEAVY_THRESHOLD);
  const notWebp = results.filter((r) => r.size <= HEAVY_THRESHOLD);

  console.log(`Found ${results.length} unoptimized images:\n`);

  if (heavy.length > 0) {
    console.log(`  Heavy images (>500KB):`);
    for (const img of heavy.slice(0, 20)) {
      console.log(`    ${img.path} (${formatSize(img.size)})`);
    }
    if (heavy.length > 20) {
      console.log(`    ... and ${heavy.length - 20} more`);
    }
    console.log();
  }

  if (notWebp.length > 0) {
    console.log(`  Not WebP (${notWebp.length} files)`);
    for (const img of notWebp.slice(0, 10)) {
      console.log(`    ${img.path} (${formatSize(img.size)})`);
    }
    if (notWebp.length > 10) {
      console.log(`    ... and ${notWebp.length - 10} more`);
    }
  }

  console.log(`\nRun 'docs-images optimize' to convert to WebP`);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
