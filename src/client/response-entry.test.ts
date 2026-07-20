import assert from "node:assert"
import { describe, it } from "node:test"
import { responseEntryRenderKey } from "./display-block"

describe("responseEntryRenderKey", () => {
  it("remounts a positional entry when a hidden-tool summary becomes an assistant response", () => {
    const summary = responseEntryRenderKey({
      kind: "system",
      text: "⚙ 1 calls · read  (/tools to show)",
    })
    const response = responseEntryRenderKey({
      kind: "assistant",
      text: "## Result",
    })

    assert.notEqual(response, summary)
  })

  it("remounts a streamed tool call when its result replaces the same slot", () => {
    const call = responseEntryRenderKey({ kind: "tool-call", title: "read", text: "{}" })
    const result = responseEntryRenderKey({ kind: "tool", title: "read", text: "contents" })

    assert.notEqual(result, call)
  })

  it("keeps an assistant renderer mounted while its text changes", () => {
    const chunk = responseEntryRenderKey({ kind: "assistant", text: "## Res", streaming: true })
    const complete = responseEntryRenderKey({ kind: "assistant", text: "## Result" })

    assert.equal(complete, chunk)
  })

  it("remounts tool renderers whose labels select different presentation", () => {
    const bash = responseEntryRenderKey({ kind: "tool-call", title: "bash", text: "{}" })
    const read = responseEntryRenderKey({ kind: "tool-call", title: "read", text: "{}" })

    assert.notEqual(read, bash)
  })
})
