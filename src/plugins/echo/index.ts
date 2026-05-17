import type { Plugin } from "../../plugin/types"

/**
 * Echo plugin — minimal test plugin that verifies the plugin system works.
 * Provides a single /echo command that echoes back the argument.
 */
export const echoPlugin: Plugin = {
  id: "echo",
  name: "Echo",
  version: "0.1.0",

  commands: [
    {
      name: "echo",
      description: "Echo back the input text",
      args: "<text>",
      async execute(args, ctx) {
        const text = args || "(nothing to echo)"
        ctx.notices(`Echo: ${text}`, "system")
      },
    },
  ],
}
