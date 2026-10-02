import { execFileSync } from "node:child_process"

const [tarball, field] = process.argv.slice(2)
if (!tarball || !["name", "version"].includes(field)) {
  throw new Error("Usage: node scripts/read-package-tarball.mjs <tarball> <name|version>")
}

const metadata = JSON.parse(execFileSync("tar", ["-xOf", tarball, "package/package.json"], { encoding: "utf8" }))
if (typeof metadata[field] !== "string" || !metadata[field].trim()) {
  throw new Error(`Missing package ${field} in ${tarball}`)
}
console.log(metadata[field])
