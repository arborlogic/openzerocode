import { Effect, Layer } from "effect"
import { buildLayer, autoDetectProvider, defaultModelForProvider, normalizeBigPickleModel } from "../provider/index"
import { layer as toolLayer, ToolRegistry } from "../tool/registry"
import { Provider } from "../provider/types"
import type { PermissionRequest } from "../tool/types"
import { streamSession, type RunMode, type StreamOptions } from "./session-runner"
import { tryParseJSON } from "./format-utils"
import { loadAgentsInstruction, loadContextInstruction } from "./workspace-memory"
import { getActiveConfiguredProviderKeyName } from "../provider/config"
import { buildSystemPrompt } from "./system-prompt"
import { testConnection, isConnected, setEnabled, readPage } from "../browser/geass-client"
import { resolveSkillsDir, matchSkillByUrl, buildSkillSection, type LoadedSkill } from "./skill-loader"
import { writeRunRecord, type RunToolEvent, type RunOutcome } from "./run-capture"

export async function handleCli(args: string[], version: string): Promise<void> {
  if (args.includes("--version") || args.includes("-v")) {
    console.log(`openzerocode v${version}`)
    process.exit(0)
  }
  if (args.includes("--help") || args.includes("-h")) {
    printHelp(version)
    process.exit(0)
  }

  if (args[0] === "serve") {
    const flagValue = (name: string, fallback: string): string => {
      const eq = args.find((a) => a.startsWith(`${name}=`))
      if (eq) return eq.slice(name.length + 1)
      const idx = args.indexOf(name)
      if (idx >= 0 && args[idx + 1]) return args[idx + 1]!
      return fallback
    }
    const port = Number.parseInt(flagValue("--port", "4096"), 10)
    const host = flagValue("--host", "127.0.0.1")
    if (!Number.isFinite(port) || port <= 0 || port > 65535) {
      console.error(`Invalid port: ${flagValue("--port", "4096")}`)
      process.exit(1)
    }
    const { startServer } = await import("../server/index")
    await startServer({ port, host })
    await new Promise<never>(() => {})
  }

  await handleHeadlessRun(args)
}

function printHelp(version: string) {
  console.log(`openzerocode v${version}`)
  console.log()
  console.log("Usage: openzerocode [options] [prompt...]")
  console.log("       openzerocode serve [--port PORT] [--host HOST]")
  console.log()
  console.log("Options:")
  console.log("  -v, --version            Show version number")
  console.log("  -h, --help               Show this help message")
  console.log("  -r, --run PROMPT         Run a single prompt headlessly (no TUI, auto-approve tools)")
  console.log()
  console.log("Commands:")
  console.log("  serve                    Start an HTTP server exposing the streaming session API")
  console.log("    --port PORT            Port to listen on (default: 4096)")
  console.log("    --host HOST            Host to bind to (default: 127.0.0.1)")
  console.log()
  console.log("  --name NAME              Register this TUI as a named peer (enables /peers and /call)")
  console.log("  --max-peer-hops N        Override shallow peer hop guard (default: 3, env: OPENZEROCODE_MAX_PEER_HOPS)")
  console.log("  --deep-collaboration     Use bounded deep collaboration instead of shallow hop counting")
  console.log("  --deep-collaboration-peer-calls N  Total non-one-way peer calls allowed per chain (default: 12)")
  console.log("  --max-same-pair-roundtrips N  Override same-pair peer loop guard (default: 4)")
  console.log()
  console.log("Examples:")
  console.log("  openzerocode                          Launch TUI")
  console.log("  openzerocode --name myapp             Launch TUI as named peer 'myapp'")
  console.log("  openzerocode --run 'reply a Threads post'  Headless agent run, stdout = result")
  console.log()
  console.log("If a prompt is provided as arguments, it runs in non-interactive mode.")
  console.log("Otherwise, the terminal UI is launched.")
}

async function handleHeadlessRun(args: string[]): Promise<void> {
  const runFlagIdx = args.findIndex((a) => a === "--run" || a === "-r")
  const headlessPrompt = runFlagIdx >= 0 && args[runFlagIdx + 1] ? args[runFlagIdx + 1] : undefined
  if (headlessPrompt === undefined) return

  const provider = autoDetectProvider() ?? "opencode-zen"
  const model = normalizeBigPickleModel(process.env.OPENZERO_MODEL ?? defaultModelForProvider(provider))
  const layer = Layer.merge(buildLayer(provider, model), toolLayer)
  const agentsInstruction = loadAgentsInstruction(process.cwd())
  const contextInstruction = loadContextInstruction(process.cwd())

  setEnabled(true)
  await testConnection()

  let activeSkill: LoadedSkill | undefined
  if (isConnected()) {
    const skillsDir = resolveSkillsDir(process.cwd())
    if (skillsDir) {
      try {
        const page = await readPage()
        if (page?.url) {
          activeSkill = matchSkillByUrl(page.url, skillsDir)
          if (activeSkill) process.stderr.write(`[skill: ${activeSkill.name}] matched by ${activeSkill.matchedBy}\n`)
        }
      } catch {
        // page read failed — proceed without a skill
      }
    }
  }
  const skillSection = activeSkill ? buildSkillSection(activeSkill) : undefined

  const runSync = <E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(layer))) as Promise<A>

  const runtime = {
    runSync,
    systemPrompt: (mode: RunMode) => {
      const base = buildSystemPrompt(mode, agentsInstruction, contextInstruction)
      return skillSection ? `${base}\n\n${skillSection}` : base
    },
    parseJson: (raw: string) => tryParseJSON(raw),
    ask: (_req: Omit<PermissionRequest, "id">) => Promise.resolve(),
  }

  const options: StreamOptions = {
    abort: new AbortController().signal,
    model,
    mode: "build" as RunMode,
    provider,
    keyName: getActiveConfiguredProviderKeyName(provider) ?? "anonymous",
  }

  let finalContent = ""
  let runOutcome: RunOutcome = "success"
  let runError: string | undefined
  const runTools: RunToolEvent[] = []
  const runStart = new Date()

  const gen = streamSession(headlessPrompt, [], options, runtime)
  for await (const chunk of gen) {
    switch (chunk.type) {
      case "text":
        process.stdout.write(chunk.content)
        finalContent += chunk.content
        break
      case "tool_start": {
        process.stderr.write(`\n[tool: ${chunk.name}] ${chunk.input.slice(0, 120)}\n`)
        runTools.push({ name: chunk.name, input: chunk.input })
        break
      }
      case "tool_result": {
        process.stderr.write(`[done: ${chunk.name}] ${chunk.output.slice(0, 120)}\n`)
        for (let i = runTools.length - 1; i >= 0; i--) {
          if (runTools[i].name === chunk.name && runTools[i].output === undefined) {
            runTools[i].output = chunk.output
            if (chunk.error) runTools[i].error = true
            break
          }
        }
        break
      }
      case "status":
        process.stderr.write(`\r${chunk.text.padEnd(40)}\r`)
        break
      case "error":
        process.stderr.write(`\nError: ${chunk.message}\n`)
        runOutcome = "fail"
        runError = chunk.message
        break
    }
  }

  let runRecordPath: string | undefined
  if (activeSkill) {
    runRecordPath = writeRunRecord({
      skillName: activeSkill.name,
      skillDir: activeSkill.dir,
      prompt: headlessPrompt,
      matchedBy: activeSkill.matchedBy,
      pageUrl: (isConnected() ? await readPage().catch(() => undefined) : undefined)?.url,
      model,
      provider,
      tools: runTools,
      finalText: finalContent,
      outcome: runOutcome,
      errorMessage: runError,
      startedAt: runStart,
      endedAt: new Date(),
    })
    process.stderr.write(`\n[capture] ${runRecordPath}\n`)
  }

  const skipReflect = process.env.OPENZERO_NO_REFLECT === "1"
  if (runOutcome === "fail" && activeSkill && runRecordPath && !skipReflect) {
    await reflectOnFailedRun({
      activeSkill,
      runRecordPath,
      provider,
      agentsInstruction: agentsInstruction ?? "",
      contextInstruction: contextInstruction ?? "",
    })
  }

  process.stdout.write("\n")
  process.exit(runOutcome === "success" ? 0 : 1)
}

async function reflectOnFailedRun(options: {
  activeSkill: LoadedSkill
  runRecordPath: string
  provider: string
  agentsInstruction: string
  contextInstruction: string
}) {
  const { activeSkill, runRecordPath, provider, agentsInstruction, contextInstruction } = options
  process.stderr.write(`\n[reflect] starting reflection for skill: ${activeSkill.name}\n`)
  const reflectModel = normalizeBigPickleModel(
    process.env.OPENZERO_REFLECT_MODEL ?? process.env.OPENZERO_MODEL ?? defaultModelForProvider(provider),
  )
  const reflectLayer = Layer.merge(buildLayer(provider, reflectModel), toolLayer)
  const reflectRunSync = <E, A>(effect: Effect.Effect<A, E, ToolRegistry | Provider>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(reflectLayer))) as Promise<A>
  const reflectRuntime = {
    runSync: reflectRunSync,
    systemPrompt: (mode: RunMode) => buildSystemPrompt(mode, agentsInstruction, contextInstruction),
    parseJson: (raw: string) => tryParseJSON(raw),
    ask: (_req: Omit<PermissionRequest, "id">) => Promise.resolve(),
  }
  const reflectOptions: StreamOptions = {
    abort: new AbortController().signal,
    model: reflectModel,
    mode: "build" as RunMode,
    provider,
    keyName: getActiveConfiguredProviderKeyName(provider) ?? "anonymous",
  }
  const reflectPrompt = [
    `You are reflecting on a failed agent run for the skill: ${activeSkill.name}.`,
    ``,
    `Files to read (use the read_file tool):`,
    `1. SKILL.md (golden path): ${activeSkill.skillPath}`,
    `2. Run record (trajectory): ${runRecordPath}`,
    activeSkill.learnings ? `3. Existing LEARNINGS.md: ${activeSkill.dir}/LEARNINGS.md` : null,
    ``,
    `Your job:`,
    `- Identify what failed: which step, which selector, which assumption was wrong.`,
    `- If this is a KNOWLEDGE issue (wrong selector, wrong flow, wrong assumption):`,
    `  Append a new learning entry to ${activeSkill.dir}/LEARNINGS.md using the format:`,
    `  ## <date> <short description>`,
    `  - Observed: <what happened>`,
    `  - Fix/Alternative: <what to try instead>`,
    `  - Confidence: low | medium | high`,
    `  Create the file if it does not exist.`,
    `- If this is a SCRIPT issue (bug in a .py or .js file):`,
    `  Write a unified diff to ${activeSkill.dir}/runs/${new Date().toISOString().replace(/[:.]/g, "-")}-reflect.patch`,
    `  Do NOT modify scripts directly.`,
    `- Do NOT modify SKILL.md.`,
    `- Do NOT make more than one file write.`,
    `- Reply with a one-paragraph summary of what you found and what you wrote.`,
  ]
    .filter((l) => l !== null)
    .join("\n")

  const reflectGen = streamSession(reflectPrompt, [], reflectOptions, reflectRuntime)
  for await (const chunk of reflectGen) {
    if (chunk.type === "text") process.stderr.write(chunk.content)
    else if (chunk.type === "tool_start") process.stderr.write(`\n[reflect tool: ${chunk.name}] ${chunk.input.slice(0, 80)}\n`)
    else if (chunk.type === "tool_result") process.stderr.write(`[reflect done: ${chunk.name}]\n`)
    else if (chunk.type === "error") process.stderr.write(`\n[reflect error] ${chunk.message}\n`)
  }
  process.stderr.write("\n[reflect] done\n")
}
