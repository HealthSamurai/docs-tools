/**
 * Walk lines of a markdown file, skipping code blocks.
 * Tracks both fenced code blocks (```) and HTML <pre> blocks.
 * Yields { line, lineNum, inCodeBlock }.
 */
export function* walkLines(
  content: string,
): Generator<{ line: string; lineNum: number; inCodeBlock: boolean }> {
  const lines = content.split("\n");
  let fenceChar = ""; // "" = not in fence, "`" or "~" when in fence
  let fenceLen = 0;
  let inPreBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Fenced code blocks: opening fence sets char+length,
    // closing fence must use same char and be at least as long (CommonMark spec)
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const char = fenceMatch[1][0];
      const len = fenceMatch[1].length;

      if (!fenceChar) {
        // Opening fence
        fenceChar = char;
        fenceLen = len;
        yield { line, lineNum: i + 1, inCodeBlock: true };
        continue;
      } else if (
        char === fenceChar &&
        len >= fenceLen &&
        trimmed.slice(len).trim() === ""
      ) {
        // Closing fence: same char, at least as long, no content after
        fenceChar = "";
        fenceLen = 0;
        yield { line, lineNum: i + 1, inCodeBlock: true };
        continue;
      }
    }

    // Track HTML <pre> blocks (from GitBook migration)
    if (!fenceChar) {
      if (/<pre[\s>]/i.test(trimmed)) inPreBlock = true;
      if (/<\/pre>/i.test(trimmed)) {
        yield { line, lineNum: i + 1, inCodeBlock: true };
        inPreBlock = false;
        continue;
      }
    }

    yield { line, lineNum: i + 1, inCodeBlock: !!fenceChar || inPreBlock };
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
