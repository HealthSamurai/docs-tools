#!/usr/bin/env bun
import { resolve } from "path";
import { loadConfig } from "../config";
import { checkUnoptimized } from "./check";
import { optimizeImages } from "./optimize";

function usage(): void {
  console.log(`Usage: docs-images <command> [options]

Commands:
  optimize             Convert PNG/JPG to WebP, compress, update refs
  check                Report heavy/unoptimized images

Options:
  --dry-run            Show what would change without modifying files
  --keep-originals     Keep original files after conversion
  --quality <n>        WebP quality (default: 85)
  --max-width <n>      Max width in px (default: 2000)
  --help               Show this help`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  const dryRun = args.includes("--dry-run");
  const keepOriginals = args.includes("--keep-originals");

  const qualityIdx = args.indexOf("--quality");
  const quality = qualityIdx !== -1 ? parseInt(args[qualityIdx + 1], 10) : 85;

  const widthIdx = args.indexOf("--max-width");
  const maxWidth = widthIdx !== -1 ? parseInt(args[widthIdx + 1], 10) : 2000;

  const root = process.cwd();
  const config = await loadConfig(root);
  const assetsDir = resolve(root, config.assets_dir);

  switch (command) {
    case "check":
      await checkUnoptimized(assetsDir);
      break;
    case "optimize":
      await optimizeImages(assetsDir, resolve(root, config.docs_dir), {
        dryRun,
        keepOriginals,
        quality,
        maxWidth,
      });
      break;
    default:
      console.error(`Unknown command: ${command}`);
      usage();
      process.exit(1);
  }
}

main();
