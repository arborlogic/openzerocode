export { type Plugin, type PluginCommand, type PluginCommandContext } from "./types"
export { PluginRegistry, pluginRegistry } from "./registry"
export { loadPlugins, loadBuiltinPlugins, loadExternalPlugins } from "./loader"
// zero-api client code is available at src/plugin/zero-api.ts but NOT exported here.
// It is kept for reference and will be integrated when zerowapper needs it.
