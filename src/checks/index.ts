import type { Check } from "../types";
import { frontmatterYaml } from "./frontmatter-yaml";
import { h1Headers } from "./h1-headers";
import { emptyHeaders } from "./empty-headers";
import { brokenReferences } from "./broken-references";
import { imageAlt } from "./image-alt";
import { deprecatedLinks } from "./deprecated-links";
import { absoluteLinks } from "./absolute-links";
import { ampersandSummary } from "./ampersand-summary";
import { summarySync } from "./summary-sync";
import { titleMismatch } from "./title-mismatch";
import { redirects } from "./redirects";
import { brokenLinks } from "./broken-links";
import { missingImages } from "./missing-images";
import { orphanPages } from "./orphan-pages";

export const allChecks: Check[] = [
  frontmatterYaml,
  h1Headers,
  emptyHeaders,
  brokenReferences,
  imageAlt,
  deprecatedLinks,
  absoluteLinks,
  ampersandSummary,
  summarySync,
  titleMismatch,
  redirects,
  brokenLinks,
  missingImages,
  orphanPages,
];
