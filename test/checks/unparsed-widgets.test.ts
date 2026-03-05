import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { unparsedWidgets } from "../../src/checks/unparsed-widgets";
import type { CheckContext, Config } from "../../src/types";

const DEFAULT_CONFIG: Config = {
  docs_dir: "docs",
  assets_dir: "assets",
  summary: "SUMMARY.md",
  redirects: "redirects.yaml",
  exclude: [],
  checks: { disable: [], warn_only: [] },
};

async function runWith(files: Record<string, string>) {
  const tmp = await mkdtemp(join(tmpdir(), "docs-lint-test-"));
  const docsDir = join(tmp, "docs");
  await Bun.write(join(tmp, "SUMMARY.md"), "# TOC\n");
  await Bun.write(join(docsDir, ".keep"), "");

  const fileNames: string[] = [];
  for (const [name, content] of Object.entries(files)) {
    await Bun.write(join(docsDir, name), content);
    fileNames.push(name);
  }

  const ctx: CheckContext = {
    root: tmp,
    docsDir,
    assetsDir: join(tmp, "assets"),
    summaryPath: join(tmp, "SUMMARY.md"),
    redirectsPath: join(tmp, "redirects.yaml"),
    exclude: [],
    config: DEFAULT_CONFIG,
    files: fileNames,
  };

  const result = await unparsedWidgets.run(ctx);
  await rm(tmp, { recursive: true });
  return result;
}

describe("unparsed-widgets", () => {
  describe("known block widgets", () => {
    it("accepts hint with all styles", async () => {
      const result = await runWith({
        "test.md": `# Test
{% hint style="info" %}
Info text.
{% endhint %}

{% hint style="success" %}
Success text.
{% endhint %}

{% hint style="warning" %}
Warning text.
{% endhint %}

{% hint style="danger" %}
Danger text.
{% endhint %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts tabs with nested tab widgets", async () => {
      const result = await runWith({
        "test.md": `# Test
{% tabs %}
{% tab title="One" %}
Content 1.
{% endtab %}
{% tab title="Two" %}
Content 2.
{% endtab %}
{% endtabs %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts stepper with nested step widgets", async () => {
      const result = await runWith({
        "test.md": `# Test
{% stepper %}
{% step %}
Step 1.
{% endstep %}
{% step %}
Step 2.
{% endstep %}
{% endstepper %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts code block with title", async () => {
      const result = await runWith({
        "test.md": `# Test
{% code title="example.yaml" %}
\`\`\`yaml
key: value
\`\`\`
{% endcode %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts content-ref", async () => {
      const result = await runWith({
        "test.md": `# Test
{% content-ref %}
[Page](page.md)
{% endcontent-ref %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts carousel", async () => {
      const result = await runWith({
        "test.md": `# Test
{% carousel %}
![Image 1](img1.png)
![Image 2](img2.png)
{% endcarousel %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts quote with attributes", async () => {
      const result = await runWith({
        "test.md": `# Test
{% quote author="Jane" title="CTO" %}
Great product.
{% endquote %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });
  });

  describe("self-closing widgets", () => {
    it("accepts embed", async () => {
      const result = await runWith({
        "test.md": `# Test
{% embed url="https://youtube.com/watch?v=123" / %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts file", async () => {
      const result = await runWith({
        "test.md": `# Test
{% file src="/assets/doc.pdf" / %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });
  });

  describe("unknown widgets", () => {
    it("reports unknown widget type", async () => {
      const result = await runWith({
        "test.md": `# Test
{% foobar %}
Content.
{% endfoobar %}
`,
      });
      expect(result.issues.length).toBeGreaterThanOrEqual(1);
      expect(result.issues[0].message).toContain("Unknown widget type");
    });
  });

  describe("tag matching", () => {
    it("reports unclosed widget", async () => {
      const result = await runWith({
        "test.md": `# Test
{% hint style="info" %}
No closing tag.
`,
      });
      const unclosed = result.issues.filter((i) =>
        i.message.includes("not closed"),
      );
      expect(unclosed).toHaveLength(1);
    });

    it("reports closing tag without opening", async () => {
      const result = await runWith({
        "test.md": `# Test
{% endhint %}
`,
      });
      const orphan = result.issues.filter((i) =>
        i.message.includes("without matching opening"),
      );
      expect(orphan).toHaveLength(1);
    });
  });

  describe("nesting rules", () => {
    it("reports tab outside tabs", async () => {
      const result = await runWith({
        "test.md": `# Test
{% tab title="Orphan" %}
Content.
{% endtab %}
`,
      });
      const nesting = result.issues.filter((i) =>
        i.message.includes("must be inside"),
      );
      expect(nesting).toHaveLength(1);
      expect(nesting[0].message).toContain("{% tabs %}");
    });

    it("reports step outside stepper", async () => {
      const result = await runWith({
        "test.md": `# Test
{% step %}
Content.
{% endstep %}
`,
      });
      const nesting = result.issues.filter((i) =>
        i.message.includes("must be inside"),
      );
      expect(nesting).toHaveLength(1);
      expect(nesting[0].message).toContain("{% stepper %}");
    });
  });

  describe("code block skipping", () => {
    it("ignores widgets inside fenced code blocks", async () => {
      const result = await runWith({
        "test.md": `# Test
\`\`\`markdown
{% hint style="info" %}
This is inside a code block.
{% endhint %}
\`\`\`
`,
      });
      expect(result.issues).toHaveLength(0);
    });
  });

  describe("nested widgets", () => {
    it("accepts hint inside tab", async () => {
      const result = await runWith({
        "test.md": `# Test
{% tabs %}
{% tab title="Info" %}
{% hint style="warning" %}
Warning inside tab.
{% endhint %}
{% endtab %}
{% endtabs %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts stepper inside tab", async () => {
      const result = await runWith({
        "test.md": `# Test
{% tabs %}
{% tab title="Steps" %}
{% stepper %}
{% step %}
Step inside tab.
{% endstep %}
{% endstepper %}
{% endtab %}
{% endtabs %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });

    it("accepts carousel inside hint", async () => {
      const result = await runWith({
        "test.md": `# Test
{% hint style="info" %}
{% carousel %}
![Img](img.png)
{% endcarousel %}
{% endhint %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });
  });

  describe("all widgets combined", () => {
    it("accepts a page with every widget type", async () => {
      const result = await runWith({
        "test.md": `# All Widgets

{% hint style="info" %}
Hint content.
{% endhint %}

{% tabs %}
{% tab title="Tab" %}
Tab content.
{% endtab %}
{% endtabs %}

{% stepper %}
{% step %}
Step content.
{% endstep %}
{% endstepper %}

{% code title="file.ts" %}
\`\`\`ts
const x = 1;
\`\`\`
{% endcode %}

{% embed url="https://example.com" / %}

{% file src="/assets/doc.pdf" / %}

{% content-ref %}
[Link](page.md)
{% endcontent-ref %}

{% carousel %}
![Image](img.png)
{% endcarousel %}

{% quote author="Author" title="Title" %}
Quote text.
{% endquote %}
`,
      });
      expect(result.issues).toHaveLength(0);
    });
  });
});
