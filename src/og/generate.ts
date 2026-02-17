import { join, dirname } from "path";
import { mkdir } from "fs/promises";
import satori from "satori";
import type { SummaryEntry } from "../lib/summary";
import { parseSummary } from "../lib/summary";
import { extractH1, extractFrontmatter } from "../lib/markdown";
import { readFile } from "../lib/files";
import { ogTemplate } from "./template";
import type { Config } from "../types";

interface GenerateOptions {
  root: string;
  config: Config;
  dryRun: boolean;
  diffOnly: boolean;
}

/**
 * Get the list of changed .md files from git diff.
 */
async function getChangedFiles(root: string): Promise<Set<string>> {
  try {
    const proc = Bun.spawn(["git", "diff", "--name-only", "HEAD~1"], {
      cwd: root,
      stdout: "pipe",
    });
    const text = await new Response(proc.stdout).text();
    return new Set(
      text
        .trim()
        .split("\n")
        .filter((f) => f.endsWith(".md")),
    );
  } catch {
    return new Set();
  }
}

/**
 * Convert a docs path like "getting-started/run-aidbox-locally.md" to a slug
 * for the OG image filename.
 */
function pathToSlug(path: string): string {
  return path
    .replace(/\.md$/, "")
    .replace(/\//g, "-")
    .replace(/README$/, "index");
}

/**
 * Load a font for satori. Uses Inter from Google Fonts CDN or local fallback.
 */
async function loadFont(): Promise<ArrayBuffer> {
  // Try to fetch Inter from Google Fonts API
  try {
    const response = await fetch(
      "https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap",
    );
    const css = await response.text();
    const fontUrl = css.match(/src:\s*url\(([^)]+)\)/)?.[1];
    if (fontUrl) {
      const fontResponse = await fetch(fontUrl);
      return fontResponse.arrayBuffer();
    }
  } catch {
    // Ignore
  }

  // Fallback: generate a minimal font buffer (satori requires at least one font)
  // In practice, you'd want a local Inter font file
  throw new Error(
    "Could not load Inter font. Place Inter-Regular.ttf in assets/ or ensure internet access.",
  );
}

export async function generateOgImages(options: GenerateOptions): Promise<void> {
  const { root, config, dryRun, diffOnly } = options;
  const docsDir = join(root, config.docs_dir);
  const ogDir = join(root, config.assets_dir, "og");

  const brand = config.og?.brand ?? "Docs";
  const color = config.og?.color ?? "#D95640";

  // Try SUMMARY.md in docs dir first, then fall back to repo root
  let summaryPath = join(docsDir, config.summary);
  if (!(await Bun.file(summaryPath).exists())) {
    summaryPath = join(root, config.summary);
  }

  const entries = await parseSummary(summaryPath);
  if (entries.length === 0) {
    console.log("No SUMMARY.md entries found");
    return;
  }

  // Filter to changed files if --diff mode
  let filteredEntries: SummaryEntry[];
  if (diffOnly) {
    const changed = await getChangedFiles(root);
    filteredEntries = entries.filter((e) => {
      const fullPath = join(config.docs_dir, e.path);
      return changed.has(fullPath) || changed.has(e.path);
    });
    if (filteredEntries.length === 0) {
      console.log("No changed docs since last commit");
      return;
    }
  } else {
    filteredEntries = entries;
  }

  console.log(`Generating OG images for ${filteredEntries.length} pages\n`);

  if (!dryRun) {
    await mkdir(ogDir, { recursive: true });
  }

  // Load font once
  let font: ArrayBuffer;
  try {
    font = await loadFont();
  } catch (e) {
    console.error(String(e));
    console.error(
      "Tip: Download Inter-Regular.ttf to your assets dir or ensure network access",
    );
    process.exit(1);
  }

  let generated = 0;

  for (const entry of filteredEntries) {
    if (!entry.path.endsWith(".md")) continue;

    const slug = pathToSlug(entry.path);
    const outPath = join(ogDir, `${slug}.png`);

    // Get title from H1 or fallback to SUMMARY title
    let title = entry.title;
    const content = await readFile(join(docsDir, entry.path));
    if (content) {
      const h1 = extractH1(content);
      if (h1) title = h1;

      // Try to get description from frontmatter
      const fm = extractFrontmatter(content);
      if (fm) {
        try {
          const yaml = await import("js-yaml");
          const data = yaml.load(fm.yaml) as { description?: string } | null;
          if (data?.description) {
            // description available for template
          }
        } catch {
          // ignore
        }
      }
    }

    if (dryRun) {
      console.log(`  Would generate: ${outPath}`);
      console.log(`    Title: ${title}`);
      generated++;
      continue;
    }

    try {
      const markup = ogTemplate({ title, brand, color });

      const svg = await satori(markup as any, {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: "Inter",
            data: font,
            weight: 400,
            style: "normal",
          },
        ],
      });

      // Convert SVG to PNG using sharp
      const sharp = (await import("sharp")).default;
      const png = await sharp(Buffer.from(svg)).png().toBuffer();
      await Bun.write(outPath, png);

      console.log(`  ${slug}.png (${title})`);
      generated++;
    } catch (e) {
      console.error(`  Error generating ${slug}: ${e}`);
    }
  }

  console.log(`\nDone: ${generated} OG image(s) ${dryRun ? "would be " : ""}generated`);
}
