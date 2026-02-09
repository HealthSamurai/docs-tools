/**
 * Walk lines of a markdown file, skipping code blocks.
 * Yields { line, lineNum, inCodeBlock }.
 */
export function* walkLines(
  content: string,
): Generator<{ line: string; lineNum: number; inCodeBlock: boolean }> {
  const lines = content.split("\n");
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      yield { line, lineNum: i + 1, inCodeBlock };
      continue;
    }

    yield { line, lineNum: i + 1, inCodeBlock };
  }
}

/**
 * Iterate over non-code-block lines only.
 */
export function* contentLines(
  content: string,
): Generator<{ line: string; lineNum: number }> {
  for (const entry of walkLines(content)) {
    if (!entry.inCodeBlock && !entry.line.trimStart().startsWith("```")) {
      yield { line: entry.line, lineNum: entry.lineNum };
    }
  }
}

/**
 * Extract YAML frontmatter string and its line offset.
 * Returns null if no frontmatter found.
 */
export function extractFrontmatter(
  content: string,
): { yaml: string; offset: number } | null {
  if (!content.startsWith("---")) return null;

  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  return { yaml: match[1], offset: 2 }; // offset for the opening ---
}

/**
 * Extract the first H1 header from markdown content (skipping code blocks).
 */
export function extractH1(content: string): string | null {
  for (const { line } of contentLines(content)) {
    const match = line.match(/^#\s+(.+)$/);
    if (match && !line.startsWith("##")) {
      return match[1].trim();
    }
  }
  return null;
}
