import { parseTransclusion } from "@silverbulletmd/silverbullet/lib/transclusion";
import { describe, expect, test } from "vitest";
import { setTransclusionWidth } from "./image_resize.ts";

describe("setTransclusionWidth", () => {
  const cases: [string, string][] = [
    ["![[img.png]]", "![[img.png|420]]"],
    ["![[img.png|300]]", "![[img.png|420]]"],
    ["![[img.png|300x200]]", "![[img.png|420]]"],
    ["![[img.png|x200]]", "![[img.png|420]]"],
    ["![[img.png|alias]]", "![[img.png|alias|420]]"],
    [
      "![[Assets/Images/Legacy Paper Summaries/image 131.png|image.png|300]]",
      "![[Assets/Images/Legacy Paper Summaries/image 131.png|image.png|420]]",
    ],
    ["![[a.png|2024 chart]]", "![[a.png|2024 chart|420]]"],
    ["![](img.png)", "![420](img.png)"],
    ["![alt](img.png)", "![alt|420](img.png)"],
    ["![alt|100x50](img.png)", "![alt|420](img.png)"],
    [
      "![a \\] b](https://x.test/i.png)",
      "![a \\] b|420](https://x.test/i.png)",
    ],
  ];

  test.each(cases)("%s", (input, expected) => {
    const result = setTransclusionWidth(input, 420);
    expect(result).toBe(expected);
    const before = parseTransclusion(input)!;
    const after = parseTransclusion(result!)!;
    expect(after.url).toBe(before.url);
    expect(after.dimension).toEqual({ width: 420 });
    if (!/^[x\d]/.test(before.alias) && before.alias !== "") {
      expect(after.alias).toBe(before.alias);
    }
  });

  test("rejects non-transclusions", () => {
    expect(setTransclusionWidth("[[img.png]]", 420)).toBeNull();
    expect(setTransclusionWidth("[alt](img.png)", 420)).toBeNull();
    expect(setTransclusionWidth("plain text", 420)).toBeNull();
  });
});
