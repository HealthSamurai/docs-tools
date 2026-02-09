import { join } from "path";
import type { Config } from "./types";

const CONFIG_FILENAME = "docs-lint.yaml";

const DEFAULT_CONFIG: Config = {
  docs_dir: "docs",
  assets_dir: "assets",
  summary: "SUMMARY.md",
  redirects: "redirects.yaml",
  exclude: ["deprecated"],
  checks: {
    disable: [],
    warn_only: ["image-alt", "orphan-pages"],
  },
};

export async function loadConfig(root: string): Promise<Config> {
  const configPath = join(root, CONFIG_FILENAME);
  const file = Bun.file(configPath);

  if (!(await file.exists())) {
    return { ...DEFAULT_CONFIG };
  }

  const yaml = await import("js-yaml");
  const text = await file.text();
  const parsed = yaml.load(text) as Partial<Config> | null;

  if (!parsed || typeof parsed !== "object") {
    return { ...DEFAULT_CONFIG };
  }

  return {
    docs_dir: parsed.docs_dir ?? DEFAULT_CONFIG.docs_dir,
    assets_dir: parsed.assets_dir ?? DEFAULT_CONFIG.assets_dir,
    summary: parsed.summary ?? DEFAULT_CONFIG.summary,
    redirects: parsed.redirects ?? DEFAULT_CONFIG.redirects,
    exclude: parsed.exclude ?? DEFAULT_CONFIG.exclude,
    checks: {
      ...DEFAULT_CONFIG.checks,
      ...(parsed.checks ?? {}),
    },
    og: parsed.og,
  };
}
