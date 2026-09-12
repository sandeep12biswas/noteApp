#!/usr/bin/env node
// `flownote` CLI entry — DESIGN.md §9.6. Deliberately no argv-parsing
// dependency (commander/yargs) — four subcommands and a handful of flags
// don't need one, and this repo already prefers a small hand-rolled
// implementation over a dependency where the surface is this small (see
// e.g. flownote-core's own migration runner).
import { buildPlugin, createPlugin, devPlugin, packPlugin, validatePluginName } from './commands'

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
  const positional: string[] = []
  const flags: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value === undefined || value.startsWith('--')) {
        flags[key] = 'true'
      } else {
        flags[key] = value
        i++
      }
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

const HELP = `flownote — scaffold, build, dev, and pack FlowNote plugins (DESIGN.md §9.6)

Usage:
  flownote create <name> [--dir <path>]   Scaffold a new plugin project
  flownote build [--cwd <path>]           Compile the plugin (tsc)
  flownote dev [--cwd <path>] [--install-into <FlowNote's packages/frontend/public dir>]
                                           Rebuild on save; optionally copy into a running FlowNote checkout
  flownote pack [--cwd <path>] [--out <file>]
                                           Zip the built plugin into a .fnp file
`

function main(argv: string[]): number {
  const [command, ...rest] = argv
  const { positional, flags } = parseFlags(rest)

  switch (command) {
    case 'create': {
      const name = positional[0]
      if (!name) {
        console.error('usage: flownote create <name> [--dir <path>]')
        return 1
      }
      const nameError = validatePluginName(name)
      if (nameError) {
        console.error(nameError)
        return 1
      }
      try {
        const dir = createPlugin({ name, cwd: flags.dir })
        console.log(`Created ${dir}`)
        console.log(`Next: cd ${name} && npm install && npm run build`)
        return 0
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err))
        return 1
      }
    }

    case 'build': {
      return buildPlugin({ cwd: flags.cwd })
    }

    case 'dev': {
      const child = devPlugin({ cwd: flags.cwd, installInto: flags['install-into'] })
      // tsc --watch keeps this child (and so the event loop) alive
      // indefinitely; the exit code below only actually takes effect once
      // it (or a Ctrl-C) ends it — `process.exitCode` can be reassigned any
      // number of times before the process truly exits.
      child.on('exit', (code) => {
        process.exitCode = code ?? 0
      })
      process.on('SIGINT', () => child.kill('SIGINT'))
      return 0
    }

    case 'pack': {
      try {
        const outPath = packPlugin({ cwd: flags.cwd, out: flags.out })
        console.log(`Wrote ${outPath}`)
        return 0
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err))
        return 1
      }
    }

    case undefined:
    case '--help':
    case '-h':
    case 'help':
      console.log(HELP)
      return command === undefined ? 1 : 0

    default:
      console.error(`unknown command "${command}"\n`)
      console.log(HELP)
      return 1
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2))
}

export { main }
