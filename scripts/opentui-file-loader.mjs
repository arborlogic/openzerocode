import { fileURLToPath } from "node:url"

export async function load(url, context, nextLoad) {
  if (url.endsWith(".scm") || url.endsWith(".wasm")) {
    const path = fileURLToPath(url)
    return {
      format: "module",
      shortCircuit: true,
      source: `export default ${JSON.stringify(path)};`,
    }
  }
  return nextLoad(url, context)
}
