import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { signBinary } from "./sign-binary"

describe("macOS binary signing", () => {
  it("force signs then verifies the exact output path", () => {
    const calls: Array<[string, string[]]> = []
    const outfile = "/tmp/custom output/openzerocode"
    signBinary(outfile, "darwin", (command, args) => { calls.push([command, args]) })
    assert.deepEqual(calls, [
      ["/usr/bin/codesign", ["--force", "--sign", "-", outfile]],
      ["/usr/bin/codesign", ["--verify", "--verbose=4", outfile]],
    ])
  })

  it("does not invoke codesign on other platforms", () => {
    for (const platform of ["linux", "win32"]) {
      signBinary("output", platform, () => { assert.fail("unexpected codesign") })
    }
  })

  for (const failingCall of [1, 2]) {
    it(`propagates ${failingCall === 1 ? "signing" : "verification"} failures`, () => {
      let calls = 0
      const failure = new Error("codesign failed")
      assert.throws(() => signBinary("output", "darwin", () => {
        if (++calls === failingCall) throw failure
      }), (error) => error === failure)
      assert.equal(calls, failingCall)
    })
  }
})
