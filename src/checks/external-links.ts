import { join } from "path";
import type { Check, CheckContext, CheckResult, Issue } from "../types";
import { extractLinks, isExternal } from "../lib/links";
import { contentLines } from "../lib/markdown";
import { readFile } from "../lib/files";

const DEFAULT_TIMEOUT = 10_000; // ms
const DEFAULT_WORKERS = 10;
const RETRY_COUNT = 3;
const RETRY_BACKOFF = 500; // ms

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const EXCLUDE_PATTERNS = [
  /localhost/i,
  /127\.0\.0\.1/,
  /example\.com/i,
  /your-domain/i,
  /\$\{.*\}/, // template variables
  /<.*>/, // placeholder links
  /\{\{.*\}\}/, // handlebars
];

const SKIP_DOMAINS = new Set(["www.terraform.io", "terraform.io"]);

// Domains that reject HEAD requests — always use GET
const ALWAYS_GET_DOMAINS = [
  "aidbox.app",
  "hl7.org",
  "www.hl7.org",
  "build.fhir.org",
  "touchstone.aegis.net",
  "www.healthit.gov",
  "developer.apple.com",
  "fhir.org",
  "www.fhir.org",
];

// Domains where certain error codes are acceptable
const ACCEPTABLE_ERROR_CODES: Record<string, number[]> = {
  "hl7.org": [405],
  "www.hl7.org": [405],
  "fhir.org": [405],
  "www.fhir.org": [405],
};

interface LinkLocation {
  file: string;
  line: number;
}

function shouldSkip(url: string): boolean {
  if (EXCLUDE_PATTERNS.some((p) => p.test(url))) return true;
  try {
    const hostname = new URL(url).hostname;
    if (SKIP_DOMAINS.has(hostname)) return true;
  } catch {
    return true;
  }
  return false;
}

function needsGet(hostname: string): boolean {
  return ALWAYS_GET_DOMAINS.some((d) => hostname.includes(d));
}

function isAcceptable(hostname: string, status: number): boolean {
  return ACCEPTABLE_ERROR_CODES[hostname]?.includes(status) ?? false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function checkUrl(
  url: string,
  timeout: number,
): Promise<{ ok: boolean; error?: string }> {
  if (shouldSkip(url)) return { ok: true };

  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return { ok: false, error: "Invalid URL" };
  }

  const headers = {
    "User-Agent": USER_AGENT,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
  };

  for (let attempt = 0; attempt < RETRY_COUNT; attempt++) {
    try {
      // Try HEAD first (faster), fall back to GET for problematic domains
      const useGet = needsGet(hostname);
      const method = useGet ? "GET" : "HEAD";

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);

      const res = await fetch(url, {
        method,
        headers,
        redirect: "follow",
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.status < 400) return { ok: true };
      if (res.status === 403) return { ok: true }; // exists but restricted
      if (isAcceptable(hostname, res.status)) return { ok: true };

      // If HEAD failed, retry with GET
      if (method === "HEAD" && [404, 405, 406].includes(res.status)) {
        const controller2 = new AbortController();
        const timer2 = setTimeout(() => controller2.abort(), timeout);
        const res2 = await fetch(url, {
          method: "GET",
          headers,
          redirect: "follow",
          signal: controller2.signal,
        });
        clearTimeout(timer2);

        if (res2.status < 400 || res2.status === 403) return { ok: true };
        if (isAcceptable(hostname, res2.status)) return { ok: true };
        return { ok: false, error: `HTTP ${res2.status}` };
      }

      // Retry on 5xx/429
      if ([429, 500, 502, 503, 504].includes(res.status)) {
        if (attempt < RETRY_COUNT - 1) {
          await sleep(RETRY_BACKOFF * (attempt + 1));
          continue;
        }
      }

      return { ok: false, error: `HTTP ${res.status}` };
    } catch (err: unknown) {
      if (attempt < RETRY_COUNT - 1) {
        await sleep(RETRY_BACKOFF * (attempt + 1));
        continue;
      }
      const msg =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Timeout"
            : err.message
          : String(err);
      return { ok: false, error: msg };
    }
  }

  return { ok: false, error: "Max retries exceeded" };
}

/**
 * Extract external links including {% embed url="..." %} directives.
 */
function extractExternalUrls(
  content: string,
  file: string,
): { url: string; loc: LinkLocation }[] {
  const results: { url: string; loc: LinkLocation }[] = [];

  // Standard markdown links
  for (const link of extractLinks(content)) {
    if (isExternal(link.href) && link.href.startsWith("http")) {
      results.push({ url: link.href, loc: { file, line: link.lineNum } });
    }
  }

  // {% embed url="..." %} directives
  const embedPattern = /\{%\s*embed\s+url="([^"]+)"/g;
  for (const { line, lineNum } of contentLines(content)) {
    embedPattern.lastIndex = 0;
    let match;
    while ((match = embedPattern.exec(line)) !== null) {
      const url = match[1];
      if (url.startsWith("http")) {
        results.push({ url, loc: { file, line: lineNum } });
      }
    }
  }

  return results;
}

/**
 * Run URL checks with concurrency limit.
 */
async function checkUrlsConcurrently(
  urls: Map<string, LinkLocation[]>,
  timeout: number,
  workers: number,
): Promise<Issue[]> {
  const issues: Issue[] = [];
  const entries = [...urls.entries()];

  // Process in batches
  for (let i = 0; i < entries.length; i += workers) {
    const batch = entries.slice(i, i + workers);
    const results = await Promise.all(
      batch.map(async ([url, locs]) => {
        const result = await checkUrl(url, timeout);
        return { url, locs, result };
      }),
    );

    for (const { url, locs, result } of results) {
      if (!result.ok) {
        for (const loc of locs) {
          issues.push({
            file: loc.file,
            line: loc.line,
            message: `Broken external link: ${url}`,
            detail: result.error,
          });
        }
      }
    }
  }

  return issues;
}

export const externalLinks: Check = {
  id: "external-links",
  name: "External Links",
  description: "External URL returned an error (404, timeout, etc). Update or remove the broken link.",
  severity: "warning",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const checkConfig = ctx.config.checks["external-links"] as
      | { timeout?: number; workers?: number }
      | undefined;
    const timeout = checkConfig?.timeout ?? DEFAULT_TIMEOUT;
    const workers = checkConfig?.workers ?? DEFAULT_WORKERS;

    // Collect all external URLs with their locations
    const urlMap = new Map<string, LinkLocation[]>();

    for (const file of ctx.files) {
      const content = await readFile(join(ctx.docsDir, file));
      if (!content) continue;

      for (const { url, loc } of extractExternalUrls(content, file)) {
        const existing = urlMap.get(url);
        if (existing) {
          existing.push(loc);
        } else {
          urlMap.set(url, [loc]);
        }
      }
    }

    const issues = await checkUrlsConcurrently(urlMap, timeout, workers);

    return {
      checkId: this.id,
      name: this.name,
      description: this.description,
      severity: this.severity,
      issues,
      filesChecked: ctx.files.length,
    };
  },
};
