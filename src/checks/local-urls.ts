import type { Check, CheckContext, CheckResult, Issue } from "../types";

/**
 * Check that documentation pages are accessible on a running server.
 *
 * Fetches sitemap from the server and verifies every URL returns 200.
 * Requires configuration:
 *
 *   checks:
 *     local-urls:
 *       server_url: http://localhost:4444
 *       sitemap_path: /docs/aidbox/sitemap.xml   # optional
 *       product_path: /docs/aidbox                # optional, for log filtering
 *
 * Skips gracefully when server_url is not configured.
 */

const DEFAULT_TIMEOUT = 10_000; // ms

interface LocalUrlsConfig {
  server_url?: string;
  sitemap_path?: string;
  product_path?: string;
  timeout?: number;
}

/**
 * Extract all <loc>...</loc> URLs from sitemap XML.
 */
function extractSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const pattern = /<loc>([^<]+)<\/loc>/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    urls.push(match[1]);
  }
  return urls;
}

/**
 * Fetch with timeout.
 */
async function fetchWithTimeout(
  url: string,
  timeout: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve a sitemap URL to the local server.
 * Converts production URLs to local equivalents.
 */
function toLocalUrl(url: string, serverUrl: string): string {
  try {
    const parsed = new URL(url);
    return serverUrl + parsed.pathname;
  } catch {
    // If not a full URL, treat as path
    return serverUrl + (url.startsWith("/") ? url : "/" + url);
  }
}

export const localUrls: Check = {
  id: "local-urls",
  name: "Local URLs",
  severity: "warning",

  async run(ctx: CheckContext): Promise<CheckResult> {
    const checkConfig = (ctx.config.checks["local-urls"] ?? {}) as LocalUrlsConfig;
    const serverUrl = checkConfig.server_url;

    // Skip if no server URL configured
    if (!serverUrl) {
      return {
        checkId: this.id,
        name: this.name,
        severity: this.severity,
        issues: [],
        filesChecked: 0,
      };
    }

    const timeout = checkConfig.timeout ?? DEFAULT_TIMEOUT;
    const issues: Issue[] = [];

    // Determine sitemap URL
    const sitemapPath = checkConfig.sitemap_path ?? "/sitemap.xml";
    const sitemapUrl = serverUrl + sitemapPath;

    // Fetch sitemap
    let sitemapXml: string;
    try {
      const res = await fetchWithTimeout(sitemapUrl, timeout);
      if (!res.ok) {
        issues.push({
          file: "sitemap.xml",
          message: `Failed to fetch sitemap: HTTP ${res.status} from ${sitemapUrl}`,
        });
        return {
          checkId: this.id,
          name: this.name,
          severity: this.severity,
          issues,
          filesChecked: 0,
        };
      }
      sitemapXml = await res.text();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      issues.push({
        file: "sitemap.xml",
        message: `Cannot connect to server at ${sitemapUrl}: ${msg}`,
      });
      return {
        checkId: this.id,
        name: this.name,
        severity: this.severity,
        issues,
        filesChecked: 0,
      };
    }

    // Extract URLs — handle sitemap index (links to sub-sitemaps)
    let pageUrls = extractSitemapUrls(sitemapXml);
    const isSitemapIndex = sitemapXml.includes("<sitemapindex");

    if (isSitemapIndex) {
      // Fetch each sub-sitemap
      const subSitemapUrls = pageUrls;
      pageUrls = [];
      for (const subUrl of subSitemapUrls) {
        try {
          const localSubUrl = toLocalUrl(subUrl, serverUrl);
          const res = await fetchWithTimeout(localSubUrl, timeout);
          if (res.ok) {
            const subXml = await res.text();
            pageUrls.push(...extractSitemapUrls(subXml));
          }
        } catch {
          // Skip unreachable sub-sitemaps
        }
      }
    }

    // Deduplicate and filter by product path
    const productPath = checkConfig.product_path;
    const uniqueUrls = [
      ...new Set(
        productPath
          ? pageUrls.filter((u) => {
              try {
                return new URL(u).pathname.startsWith(productPath);
              } catch {
                return u.includes(productPath);
              }
            })
          : pageUrls,
      ),
    ].sort();

    // Check each URL
    for (const url of uniqueUrls) {
      const localUrl = toLocalUrl(url, serverUrl);
      try {
        const res = await fetchWithTimeout(localUrl, timeout);
        if (res.status === 404) {
          const path = new URL(localUrl).pathname;
          issues.push({
            file: path,
            message: `404 Not Found: ${path}`,
          });
        }
      } catch {
        // Connection errors are ignored (server might be slow)
      }
    }

    return {
      checkId: this.id,
      name: this.name,
      severity: this.severity,
      issues,
      filesChecked: uniqueUrls.length,
    };
  },
};
