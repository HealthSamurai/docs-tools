import { readFile } from "./files";

export interface SummaryEntry {
  title: string;
  path: string;
  lineNum: number;
}

const LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/;

/**
 * Parse SUMMARY.md and extract [title](path) entries.
 * Only includes entries where path ends with .md or points to a directory.
 */
export async function parseSummary(summaryPath: string): Promise<SummaryEntry[]> {
  const content = await readFile(summaryPath);
  if (!content) return [];

  const entries: SummaryEntry[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(LINK_PATTERN);
    if (!match) continue;

    const [, title, path] = match;
    // Skip external URLs
    if (/^https?:\/\//.test(path)) continue;

    entries.push({
      title: title.trim(),
      path,
      lineNum: i + 1,
    });
  }

  return entries;
}

/**
 * Get all paths from SUMMARY.md entries.
 */
export function summaryPaths(entries: SummaryEntry[]): Set<string> {
  return new Set(entries.map((e) => e.path));
}
