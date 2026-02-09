import { contentLines } from "./markdown";

export interface ExtractedLink {
  text: string;
  href: string;
  lineNum: number;
  isImage: boolean;
}

/**
 * Extract all markdown links from content (skipping code blocks).
 * Returns both regular links [text](href) and image links ![alt](src).
 */
export function extractLinks(content: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const linkPattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;

  for (const { line, lineNum } of contentLines(content)) {
    let match;
    linkPattern.lastIndex = 0;
    while ((match = linkPattern.exec(line)) !== null) {
      links.push({
        text: match[2],
        href: match[3].split("#")[0], // strip anchor
        lineNum,
        isImage: match[1] === "!",
      });
    }
  }

  return links;
}

/**
 * Check if a link is external (http/https/mailto/etc).
 */
export function isExternal(href: string): boolean {
  return /^(https?:\/\/|mailto:|ftp:\/\/|#)/.test(href);
}

/**
 * Check if a href points to an image file.
 */
export function isImageHref(href: string): boolean {
  return /\.(png|jpg|jpeg|gif|svg|webp|bmp|tiff)$/i.test(href);
}
