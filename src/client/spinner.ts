import chalk from "chalk"

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

export function spinner(msg: string): { stop: (final?: string) => void; update: (msg: string) => void } {
  let i = 0
  let current = msg
  const cols = process.stdout.columns || 80
  const interval = setInterval(() => {
    const frame = FRAMES[i % FRAMES.length]
    process.stdout.write(`\r${chalk.cyan(frame)} ${current}`)
    i++
  }, 80)

  return {
    stop: (final?: string) => {
      clearInterval(interval)
      process.stdout.write("\r" + " ".repeat(cols - 1) + "\r")
      if (final) process.stdout.write(final)
    },
    update: (msg: string) => { current = msg },
  }
}
