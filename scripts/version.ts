#!/usr/bin/env bun

import pkg from "../package.json" with { type: "json" }

export function formatDevVersion(baseVersion: string, when = new Date()): string {
  const year = when.getFullYear()
  const month = String(when.getMonth() + 1).padStart(2, "0")
  const day = String(when.getDate()).padStart(2, "0")
  const hours = String(when.getHours()).padStart(2, "0")
  const minutes = String(when.getMinutes()).padStart(2, "0")
  const seconds = String(when.getSeconds()).padStart(2, "0")
  return `${baseVersion}-dev.${year}${month}${day}${hours}${minutes}${seconds}`
}

export function resolveBuildVersion(options?: { dev?: boolean; now?: Date }): string {
  if (options?.dev) {
    return formatDevVersion(pkg.version, options.now)
  }
  return pkg.version
}

const isMain = import.meta.path === Bun.main

if (isMain) {
  const args = new Set(process.argv.slice(2))
  const dev = args.has("--dev")
  console.log(resolveBuildVersion({ dev }))
}
