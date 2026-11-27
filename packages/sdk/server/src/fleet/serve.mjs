import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { JsonRpcLineTransport } from '@deepseek-ai/dsh-sdk-protocol'
import { fleetHttpServer } from './http.mjs'

async function main(configPath) {
  const config = JSON.parse(await readFile(configPath, 'utf8'))
  const { cwd, provider, model, patches, port, tokenFile } = config
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || typeof tokenFile !== 'string' || !isAbsolute(tokenFile)
    || !Array.isArray(patches) || !patches.every(path => typeof path === 'string' && isAbsolute(path))
    || typeof provider !== 'string' || !provider || typeof model !== 'string' || !model
    || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Invalid DSH Fleet configuration')
  }
  const token = (await readFile(tokenFile, 'utf8')).trim()
  let ready = false
  let shuttingDown = false
  const server = fleetHttpServer({ ...config, token }, {
    request: (...args) => peer.request(...args),
  }, () => ready)
  const worker = spawn('dsh', ['--profile', 'sdk', ...patches.flatMap(path => ['--patch', path])], {
    cwd,
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  const peer = new JsonRpcLineTransport(worker.stdout, worker.stdin)
  peer.start()
  worker.stdin.on('error', () => peer.close())
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    ready = false
    server.close()
    server.closeAllConnections()
    try {
      await peer.request('shutdown', {}, AbortSignal.timeout(8000))
    } catch {
      worker.kill('SIGTERM')
    }
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  worker.once('exit', () => {
    if (!shuttingDown) process.exitCode = 1
    peer.close()
    server.close()
    server.closeAllConnections()
  })
  try {
    await once(worker, 'spawn')
    const result = await peer.request('initialize', { cwd, provider, model }, AbortSignal.timeout(30000))
    if (result.serverInfo?.name !== 'deepseek-harness-sdk-runtime') throw new Error('Wrong SDK worker')
    ready = true
    server.listen(port, '0.0.0.0')
    await once(server, 'listening')
  } catch {
    await shutdown()
    throw new Error('DSH Fleet service did not start')
  }
}

main(process.argv[2]).catch(() => {
  process.stderr.write('DSH Fleet configuration or worker startup failed\n')
  process.exitCode = 1
})
