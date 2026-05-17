import type { Plugin, PluginCommand } from "./types"

export class PluginRegistry {
  private plugins = new Map<string, Plugin>()

  register(plugin: Plugin): void {
    if (this.plugins.has(plugin.id)) {
      console.warn(`Plugin "${plugin.id}" already registered, skipping`)
      return
    }
    this.plugins.set(plugin.id, plugin)
  }

  get(id: string): Plugin | undefined {
    return this.plugins.get(id)
  }

  list(): Plugin[] {
    return [...this.plugins.values()]
  }

  collectSystemPrompts(): string[] {
    const result: string[] = []
    for (const plugin of this.plugins.values()) {
      const prompt = plugin.systemPrompt?.()
      if (prompt) result.push(prompt)
    }
    return result
  }

  /**
   * Find a plugin command by name across all registered plugins.
   * Returns the first match. Does not check for duplicate command names.
   */
  findCommand(name: string): { plugin: Plugin; command: PluginCommand } | undefined {
    for (const plugin of this.plugins.values()) {
      for (const cmd of plugin.commands ?? []) {
        if (cmd.name === name) {
          return { plugin, command: cmd }
        }
      }
    }
    return undefined
  }
}

/** Singleton registry instance */
export const pluginRegistry = new PluginRegistry()
