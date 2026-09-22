import { runAxEvalCli } from "../packages/pi-backend/test/fixtures/jev-computer-scenarios.ts"

const result = await runAxEvalCli(process.argv.slice(2))
process.stdout.write(`${JSON.stringify(result.json, null, 2)}\n`)
process.exit(result.exitCode)
