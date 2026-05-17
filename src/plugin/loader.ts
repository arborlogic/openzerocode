import { existsSync, mkdirSync, readdirSync } from "fs"
import { homedir } from "os"
import { join } from "path"
import { pluginRegistry } from "./registry"
import type { Plugin } from "./types"
import { echoPlugin } from "../plugins/echo/index"

/**
 * 載入所有內建 plugin（compile-time 綁定）。
 *
 * 這些 plugin 永遠都會被載入，不需要外部檔案。
 */
export function loadBuiltinPlugins(): void {
  const builtins: Plugin[] = [
    echoPlugin,
  ]

  for (const plugin of builtins) {
    pluginRegistry.register(plugin)
  }
}

/**
 * 載入外部 plugin（runtime 從 ~/.openzerocode/plugins/ 掃描）。
 *
 * 安裝方式：
 *   1. 寫一個 .ts 檔，export { plugin } 或 export default plugin
 *   2. cp my-plugin.ts ~/.openzerocode/plugins/
 *   3. 重啟 openzerocode
 *
 * 不需要改 source code、不需要重新 build、不需要 npm install。
 */
export async function loadExternalPlugins(): Promise<void> {
  const dir = getPluginDir()

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
    return
  }

  const files = readdirSync(dir).filter(
    (f) => f.endsWith(".ts") || f.endsWith(".js") || f.endsWith(".mjs"),
  )

  for (const file of files) {
    const filePath = join(dir, file)
    try {
      const mod = await import(filePath)
      const plugin: Plugin | undefined = (mod as any).plugin ?? (mod as any).default

      if (!plugin || !plugin.id) {
        console.warn(`[plugin] skipped ${file}: missing plugin id or export`)
        continue
      }

      pluginRegistry.register(plugin)
      console.log(`[plugin] loaded: ${plugin.id} from ${file}`)
    } catch (err) {
      console.error(`[plugin] failed to load ${file}:`, err)
    }
  }
}

/** 載入所有 plugin（內建 + 外部），在啟動時呼叫一次即可。 */
export async function loadPlugins(): Promise<void> {
  loadBuiltinPlugins()
  await loadExternalPlugins()
}

function getPluginDir(): string {
  return join(homedir(), ".openzerocode", "plugins")
}
