export interface Check {
  id: string;
  name: string;
  severity: "error" | "warning";
  run(ctx: CheckContext): Promise<CheckResult>;
}

export interface CheckResult {
  checkId: string;
  name: string;
  severity: "error" | "warning";
  issues: Issue[];
  filesChecked: number;
}

export interface Issue {
  file: string;
  line?: number;
  message: string;
  detail?: string;
}

export interface CheckContext {
  root: string;         // absolute path to repo root
  docsDir: string;      // absolute path to docs dir
  assetsDir: string;    // absolute path to assets dir
  summaryPath: string;  // absolute path to SUMMARY.md
  redirectsPath: string; // absolute path to redirects.yaml
  exclude: string[];    // directory names to exclude
  config: Config;
  files: string[];      // all markdown files (relative to docsDir)
}

export interface Config {
  docs_dir: string;
  assets_dir: string;
  summary: string;
  redirects: string;
  exclude: string[];
  checks: ChecksConfig;
  og?: OgConfig;
}

export interface ChecksConfig {
  disable: string[];
  warn_only: string[];
  [key: string]: unknown;
}

export interface OgConfig {
  brand?: string;
  color?: string;
  logo?: string;
}
