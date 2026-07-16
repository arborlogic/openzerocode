#!/usr/bin/env node
import fs from "node:fs"
import path from "node:path"

const root = path.resolve(process.cwd())
const distRoot = path.join(root, "npm")
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"))

const normalizeReadmeForNpm = (content) =>
  content
    .replace(/!\[OpenZeroCode preview\]\((?:\.\/)?preview01\.png\)/g, "![OpenZeroCode preview](https://raw.githubusercontent.com/arborlogic/openzerocode/main/preview01.png)")
    .replace(/!\[OpenZeroCode TUI session\]\((?:\.\/)?docs\/assets\/openzerocode-demo\.gif\)/g, "![OpenZeroCode TUI session](https://raw.githubusercontent.com/arborlogic/openzerocode/main/docs/assets/openzerocode-demo.gif)")

const platforms = [
  { id: "darwin-arm64", os: ["darwin"], cpu: ["arm64"], binary: "openzerocode" },
  { id: "linux-x64", os: ["linux"], cpu: ["x64"], binary: "openzerocode" },
  { id: "linux-arm64", os: ["linux"], cpu: ["arm64"], binary: "openzerocode" },
  { id: "win32-x64", os: ["win32"], cpu: ["x64"], binary: "openzerocode.exe" },
]

const generatedRoot = path.join(distRoot, "packages")
fs.mkdirSync(generatedRoot, { recursive: true })

const optionalDependencies = Object.fromEntries(
  platforms.map((platform) => [`@openzerocode/${platform.id}`, pkg.version]),
)

const sharedMetadata = {
  license: pkg.license,
  repository: pkg.repository,
  homepage: pkg.homepage,
  bugs: pkg.bugs,
  author: pkg.author,
  funding: pkg.funding,
  keywords: pkg.keywords,
}

const platformReadme = (platform) => `# @openzerocode/${platform.id}

Prebuilt **${platform.id}** binary package for [OpenZeroCode](https://github.com/arborlogic/openzerocode).

This package is normally installed automatically as an optional dependency of:

\`\`\`bash
npm install -g openzerocode
\`\`\`

## Purpose

- Contains the native executable for **${platform.os.join(", ")}/${platform.cpu.join(", ")}**
- Intended for internal distribution use by the root \`openzerocode\` package
- Not usually installed directly unless you specifically need this target package

## Usage

The recommended install path is:

\`\`\`bash
npm install -g openzerocode
openzerocode
\`\`\`

Repository and documentation:

- GitHub: https://github.com/arborlogic/openzerocode
- Main package: https://www.npmjs.com/package/openzerocode
`

const rootPackage = {
  name: pkg.name,
  version: pkg.version,
  type: pkg.type,
  description: pkg.description,
  ...sharedMetadata,
  bin: { openzerocode: "bin/openzerocode.js" },
  files: ["bin/openzerocode.js", "bin/package.json", "README.md", "LICENSE", "preview01.png"],
  scripts: { postinstall: "node bin/openzerocode.js --postinstall-check" },
  optionalDependencies,
}

const launcher = [
  '#!/usr/bin/env node',
  'const fs = require("node:fs")',
  'const path = require("node:path")',
  'const { spawnSync } = require("node:child_process")',
  '',
  'const packageNameByTarget = {',
  '  "darwin-arm64": "@openzerocode/darwin-arm64",',
  '  "linux-x64": "@openzerocode/linux-x64",',
  '  "linux-arm64": "@openzerocode/linux-arm64",',
  '  "win32-x64": "@openzerocode/win32-x64",',
  '}',
  '',
  'const ext = process.platform === "win32" ? ".exe" : ""',
  'const target = process.platform + "-" + process.arch',
  'const packageName = packageNameByTarget[target]',
  '',
  'function fail(message) {',
  '  console.error("[openzerocode] " + message)',
  '  process.exit(1)',
  '}',
  '',
  'function resolveBinary() {',
  '  if (!packageName) {',
  '    fail("Unsupported platform: " + target)',
  '  }',
  '',
  '  let packageJsonPath',
  '  try {',
  '    packageJsonPath = require.resolve(packageName + "/package.json")',
  '  } catch {',
  '    fail("Platform package " + packageName + " is not installed. Try reinstalling openzerocode on " + target + ".")',
  '  }',
  '',
  '  const packageDir = path.dirname(packageJsonPath)',
  '  const binaryPath = path.join(packageDir, "bin", "openzerocode" + ext)',
  '  if (!fs.existsSync(binaryPath)) {',
  '    fail("Expected binary missing: " + binaryPath)',
  '  }',
  '  return binaryPath',
  '}',
  '',
  'if (process.argv.includes("--postinstall-check")) {',
  '  resolveBinary()',
  '  process.exit(0)',
  '}',
  '',
  'const binaryPath = resolveBinary()',
  'const result = spawnSync(binaryPath, process.argv.slice(2), { stdio: "inherit" })',
  'if (result.error) {',
  '  fail(result.error.message)',
  '}',
  'process.exit(result.status ?? 0)',
  '',
].join("\n")

fs.mkdirSync(path.join(distRoot, "bin"), { recursive: true })
fs.writeFileSync(path.join(distRoot, "bin", "openzerocode.js"), launcher)
fs.writeFileSync(path.join(distRoot, "package.json"), JSON.stringify(rootPackage, null, 2) + "\n")

for (const platform of platforms) {
  const packageDir = path.join(generatedRoot, platform.id)
  fs.mkdirSync(path.join(packageDir, "bin"), { recursive: true })
  fs.cpSync(path.join(root, "skills"), path.join(packageDir, "bin", "bundled-skills"), {
    recursive: true,
    force: true,
  })

  const platformPackage = {
    name: `@openzerocode/${platform.id}`,
    version: pkg.version,
    os: platform.os,
    cpu: platform.cpu,
    files: ["README.md", `bin/${platform.binary}`, "bin/bundled-skills"],
    preferUnplugged: true,
    description: `${pkg.description} (${platform.id} binary)`,
    ...sharedMetadata,
  }

  fs.writeFileSync(path.join(packageDir, "package.json"), JSON.stringify(platformPackage, null, 2) + "\n")
  fs.writeFileSync(path.join(packageDir, "README.md"), platformReadme(platform))
}

const rootReadme = path.join(root, "README.md")
const rootLicense = path.join(root, "LICENSE")
const rootPreview = path.join(root, "preview01.png")
if (fs.existsSync(rootReadme)) {
  const readme = fs.readFileSync(rootReadme, "utf8")
  fs.writeFileSync(path.join(distRoot, "README.md"), normalizeReadmeForNpm(readme))
}
if (fs.existsSync(rootLicense)) fs.copyFileSync(rootLicense, path.join(distRoot, "LICENSE"))
if (fs.existsSync(rootPreview)) fs.copyFileSync(rootPreview, path.join(distRoot, "preview01.png"))

const rootBinPackage = path.join(root, "bin", "package.json")
if (fs.existsSync(rootBinPackage)) {
  fs.mkdirSync(path.join(distRoot, "bin"), { recursive: true })
  fs.copyFileSync(rootBinPackage, path.join(distRoot, "bin", "package.json"))
}

console.log("Generated npm packaging manifests in ./npm")
