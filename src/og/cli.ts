#!/usr/bin/env bun
import { loadConfig } from "../config";
import { generateOgImages } from "./generate";

function usage(): void {
  console.log(`Usage: docs-og <command> [options]

Commands:
  generate             Generate OG images for all pages

Options:
  --diff               Only for changed pages (git diff)
  --dry-run            Show what would be generated
  --help               Show this help

Config (in docs-lint.yaml):
  og:
    brand: Aidbox              # product name on the image
    color: "#D95640"           # brand color for accent
    logo: ./assets/logo.svg    # optional product logo`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  if (command !== "generate") {
    console.error(`Unknown command: ${command}`);
    usage();
    process.exit(1);
  }

  const dryRun = args.includes("--dry-run");
  const diffOnly = args.includes("--diff");

  const root = process.cwd();
  const config = await loadConfig(root);

  await generateOgImages({ root, config, dryRun, diffOnly });
}

main();
