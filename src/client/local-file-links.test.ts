import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { linkCompletionReportPaths } from "./local-file-links"

const cwd = "/Users/tester/project"

describe("linkCompletionReportPaths", () => {
  it("converts completion-report paths to encoded absolute file URIs", () => {
    const input = [
      "- Modified: src/build-english-deck.mjs",
      "- Added: docs/vc-audit-and-evidence.md",
      "- **Deleted:** docs/obsolete.md",
      "- Regenerated: outputs/45_沅樹科技股份有限公司.pptx",
      "- Regenerated: outputs/45_沅樹科技股份有限公司.pdf",
      "- Regenerated: outputs/45_沅樹科技股份有限公司.pptx.inspect.ndjson",
    ].join("\n")

    assert.equal(linkCompletionReportPaths(input, cwd), [
      "- Modified: [src/build-english-deck.mjs](<file:///Users/tester/project/src/build-english-deck.mjs>)",
      "- Added: [docs/vc-audit-and-evidence.md](<file:///Users/tester/project/docs/vc-audit-and-evidence.md>)",
      "- **Deleted:** [docs/obsolete.md](<file:///Users/tester/project/docs/obsolete.md>)",
      "- Regenerated: [outputs/45_沅樹科技股份有限公司.pptx](<file:///Users/tester/project/outputs/45_%E6%B2%85%E6%A8%B9%E7%A7%91%E6%8A%80%E8%82%A1%E4%BB%BD%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8.pptx>)",
      "- Regenerated: [outputs/45_沅樹科技股份有限公司.pdf](<file:///Users/tester/project/outputs/45_%E6%B2%85%E6%A8%B9%E7%A7%91%E6%8A%80%E8%82%A1%E4%BB%BD%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8.pdf>)",
      "- Regenerated: [outputs/45_沅樹科技股份有限公司.pptx.inspect.ndjson](<file:///Users/tester/project/outputs/45_%E6%B2%85%E6%A8%B9%E7%A7%91%E6%8A%80%E8%82%A1%E4%BB%BD%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8.pptx.inspect.ndjson>)",
    ].join("\n"))
  })

  it("produces Markdown links whose destination is a file URI", async () => {
    const { marked } = await import("marked")
    const [token] = marked.lexer(linkCompletionReportPaths("- Regenerated: outputs/report.pdf", cwd))
    const link = (token as { items: Array<{ tokens: Array<{ tokens: Array<{ type: string; href?: string }> }> }> }).items[0]!.tokens[0]!.tokens.find((item) => item.type === "link")

    assert.equal(link?.href, "file:///Users/tester/project/outputs/report.pdf")
  })

  it("accepts bold labels and leaves ordinary prose, external URLs, and code fences unchanged", () => {
    const input = [
      "- Modified: https://example.com/report",
      "Mention outputs/report.pdf without a report label.",
      "```text",
      "- Regenerated: outputs/example.pdf",
      "```",
    ].join("\n")

    assert.equal(linkCompletionReportPaths(input, cwd), input)
  })
})
