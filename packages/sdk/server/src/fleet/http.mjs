import { createHash, timingSafeEqual } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { setTimeout } from 'node:timers/promises'

const id = /^[a-zA-Z0-9_:.@/-]{1,255}$/
const digest = /^[a-f0-9]{64}$/
const runPath = /^\/v1\/runs\/(fleet-run-[a-f0-9]{64})(?:\/(events|stop|steer|approval|question))?$/
const revisionHeader = 'x-dsh-deployment-revision'
const active = new Set(['queued', 'running'])
const statuses = new Set([...active, 'completed', 'failed', 'cancelled', 'interrupted'])
const endpoints = {
  runs: { method: 'POST', path: '/v1/runs' },
  run_acceptance_lookup: { method: 'POST', path: '/v1/runs/lookup' },
  run_status: { method: 'GET', path: '/v1/runs/{run_id}' },
  run_events: { method: 'GET', path: '/v1/runs/{run_id}/events' },
  run_stop: { method: 'POST', path: '/v1/runs/{run_id}/stop' },
  run_steer: { method: 'POST', path: '/v1/runs/{run_id}/steer' },
  run_approval: { method: 'POST', path: '/v1/runs/{run_id}/approval' },
  run_question: { method: 'POST', path: '/v1/runs/{run_id}/question' },
}

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function check(condition, status, message) {
  if (!condition) throw new HttpError(status, message)
}

function json(response, status, value, headers) {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  response.end(JSON.stringify(value))
}

async function readRequest(request) {
  check(request.headers['content-type'] === 'application/json', 415, 'Expected JSON content')
  const chunks = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.byteLength
    check(size <= 2 * 1024 * 1024, 413, 'Run request is too large')
    chunks.push(chunk)
  }
  const body = Buffer.concat(chunks)
  let value
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body))
  } catch {
    throw new HttpError(400, 'Malformed run request')
  }
  check(value && typeof value === 'object' && !Array.isArray(value), 400, 'Expected a run object')
  return { value, requestHash: createHash('sha256').update(body).digest('hex') }
}

function capability({ deploymentId, revision }) {
  return {
    object: 'dsh.api_server.capabilities',
    platform: 'dsh',
    deployment_id: deploymentId,
    deployment_revision: revision,
    auth: { type: 'bearer', required: true },
    runtime: { mode: 'server_agent', tool_execution: 'server', split_runtime: false },
    features: {
      runs_idempotency: { supported: true, durable: true, retention_seconds: null },
      run_submission: true,
      run_acceptance_lookup: true,
      run_status: true,
      run_events_sse: true,
      run_stop: true,
      run_steer: true,
      run_approval: true,
      run_approval_response: true,
      approval_events: true,
      run_question_response: true,
      question_events: true,
    },
    endpoints,
  }
}

function interactionView(run, interaction) {
  const identity = { run_id: run.runId, session_id: run.sessionId, request_id: interaction.requestId }
  if (interaction.kind === 'approval') {
    return { ...identity, event: 'approval.request', prompt: interaction.prompt, choices: ['once', 'deny'] }
  }
  return { ...identity, event: 'question.request', questions: interaction.questions }
}

function runView(run) {
  const approvals = run.pending.filter(interaction => interaction.kind === 'approval')
    .map(interaction => interactionView(run, interaction))
  const questions = run.pending.filter(interaction => interaction.kind === 'question')
    .map(interaction => interactionView(run, interaction))
  return {
    object: 'hermes.run',
    run_id: run.runId,
    session_id: run.sessionId,
    deployment_revision: run.revision,
    status: approvals.length === 0 ? run.status : 'waiting_for_approval',
    ...(approvals.length === 0 ? {} : { approval: approvals[0], approvals }),
    ...(questions.length === 0 ? {} : { questions }),
    output: run.output,
    completed: run.status === 'completed',
    partial: run.status !== 'completed' && run.output !== '',
    interrupted: run.status === 'interrupted',
  }
}

function eventPayload(run, event) {
  const identity = { run_id: run.runId, session_id: run.sessionId }
  switch (event.type) {
    case 'accepted': return { ...identity, event: 'run.created' }
    case 'started': return { ...identity, event: 'run.started' }
    case 'output': return { ...identity, event: 'message.completed', text: event.text }
    case 'interaction-requested': return interactionView(run, event.interaction)
    case 'interaction-closed':
      return { ...identity, event: event.kind + '.closed', request_id: event.requestId, answered: event.answered }
    case 'ended': return { ...runView(run), event: 'run.' + event.status }
    default: throw new Error('Unknown native DSH run event')
  }
}

function signalFor(response) {
  const closed = new AbortController()
  response.once('close', () => closed.abort())
  return closed.signal
}

async function writeEvent(response, payload, seq, signal) {
  const frame = 'id: ' + seq + '\nevent: ' + payload.event + '\ndata: ' + JSON.stringify(payload) + '\n\n'
  if (!response.write(frame)) await once(response, 'drain', { signal })
}

/** Maps the deployed DSH worker to Fleet's common authenticated run transport. */
export function fleetHttpServer(config, peer, isReady) {
  const { token, revision, deploymentId, provider, model } = config
  if (typeof token !== 'string' || !/^[a-zA-Z0-9._-]{32,200}$/.test(token)
    || typeof deploymentId !== 'string' || !id.test(deploymentId)
    || typeof revision !== 'string' || !digest.test(revision)) {
    throw new Error('Invalid DSH Fleet deployment identity or credential')
  }
  const authorized = Buffer.from('Bearer ' + token)
  const cap = capability(config)
  const rpc = (method, params, signal) => peer.request('fleet/run/' + method, params,
    AbortSignal.any([signal, AbortSignal.timeout(8000)]))

  async function readRun(runId, signal, after) {
    const value = await rpc('get', { runId, ...(after === undefined ? {} : { after }) }, signal)
    check(value.kind !== 'not-found', 404, 'Run not found')
    check(value.kind === 'run' && value.runId === runId && statuses.has(value.status), 503, 'Run unavailable')
    return value
  }

  async function recoverRun(runId, signal) {
    const run = await readRun(runId, signal)
    if (!active.has(run.status)) return run
    check(run.revision === revision, 409, 'Original DSH configuration is required')
    // Recovery is a no-op for a live or terminal run and never submits new input.
    await rpc('recover', { runId }, signal)
    return readRun(runId, signal)
  }

  async function runEvents(request, response, runId, signal) {
    const cursor = request.headers['last-event-id']
    let after = cursor === undefined ? -1 : Number(cursor)
    check(cursor === undefined || (/^[0-9]+$/.test(cursor) && Number.isSafeInteger(after)), 400, 'Invalid event cursor')
    await recoverRun(runId, signal)
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    })
    response.flushHeaders()
    let heartbeat = Date.now()
    while (!signal.aborted) {
      const run = await readRun(runId, signal, after)
      for (const event of run.events) {
        await writeEvent(response, eventPayload(run, event), event.seq, signal)
        after = event.seq
      }
      if (!active.has(run.status)) break
      if (Date.now() - heartbeat >= 15000) {
        if (!response.write(': heartbeat\n\n')) await once(response, 'drain', { signal })
        heartbeat = Date.now()
      }
      await setTimeout(250, undefined, { signal })
    }
    response.end()
  }

  async function admission(request, response, lookup, signal) {
    const key = request.headers['idempotency-key']
    const requestedRevision = request.headers[revisionHeader]
    check(typeof key === 'string' && id.test(key), 400, 'Invalid operation key')
    check(typeof requestedRevision === 'string' && digest.test(requestedRevision), 400, 'Invalid deployment revision')
    const { value, requestHash } = await readRequest(request)
    const { session_id: sessionId, input } = value
    check(typeof sessionId === 'string' && id.test(sessionId) && typeof input === 'string'
      && input.trim() !== '' && Buffer.byteLength(input) <= 1024 * 1024, 400, 'Invalid Fleet input or session')
    const params = { key, input, sessionId, deploymentId, revision: requestedRevision, requestHash }

    // Resolve an already accepted request before checking new-submission configuration.
    const existing = await rpc('lookup', params, signal)
    check(existing.kind !== 'conflict', 409, 'Operation key belongs to another request')
    if (lookup) check(existing.kind !== 'not-found', 404, 'Run not found')
    const alreadyAccepted = existing.kind === 'accepted'
    if (!alreadyAccepted) {
      check(requestedRevision === revision, 409, 'DSH configuration changed')
      const allowed = new Set(['session_id', 'input', 'model', 'provider'])
      check(Object.keys(value).every(field => allowed.has(field))
        && (value.model === undefined || value.model === model)
        && (value.provider === undefined || value.provider === provider), 422,
      'Run configuration differs from the configured DSH deployment')
    }
    const result = alreadyAccepted ? existing : await rpc('submit', params, signal)
    check(result.kind !== 'conflict', 409, 'Operation key belongs to another request')
    check(result.kind === 'accepted' && result.sessionId === sessionId
      && result.revision === requestedRevision && typeof result.replayed === 'boolean'
      && (!lookup || result.replayed), 503, 'Run acceptance is not verified')
    json(response, lookup ? 200 : 202, {
      run_id: result.runId,
      status: result.replayed ? runView(await readRun(result.runId, signal)).status : 'started',
      replayed: result.replayed,
      deployment_revision: result.revision,
    }, { 'X-Hermes-Session-Id': result.sessionId })
  }

  async function reply(request, response, runId, action, signal) {
    const { value } = await readRequest(request)
    const { request_id: requestId } = value
    check(typeof requestId === 'string' && /^[a-f0-9-]{36}$/.test(requestId), 400, 'Invalid decision request identity')
    let answer
    if (action === 'approval') {
      check(Object.keys(value).length === 3 && value.resolve_all === false
        && (value.choice === 'once' || value.choice === 'deny'), 400, 'Expected a decision for one action')
      answer = value.choice
    } else {
      check(Object.keys(value).length === 2 && Object.hasOwn(value, 'response'), 400, 'Expected a structured question response')
      answer = value.response
    }
    const run = await readRun(runId, signal)
    check(run.revision === revision && active.has(run.status), 409, 'Original DSH run is unavailable for the decision')
    const result = await rpc(action, { runId, requestId, response: answer }, signal)
    check(result.kind !== 'invalid-answer', 400, 'Decision does not match the request')
    check(result.kind === 'resolved', 409, 'That request is no longer pending for this run')
    json(response, 200, {
      object: 'hermes.run.' + action + '_response',
      run_id: runId,
      request_id: requestId,
      resolved: 1,
      ...(action === 'approval' ? { choice: answer } : {}),
    })
  }

  async function steer(request, response, runId, signal) {
    const { value } = await readRequest(request)
    check(Object.keys(value).length === 1 && typeof value.input === 'string'
      && value.input.trim() && Buffer.byteLength(value.input) <= 1024 * 1024, 400, 'Invalid guidance input')
    const run = await readRun(runId, signal)
    check(run.revision === revision && run.status === 'running', 409, 'Original DSH run cannot accept guidance')
    const result = await rpc('steer', { runId, input: value.input }, signal)
    check(result.kind === 'accepted', 409, 'DSH run cannot accept guidance')
    json(response, 200, { object: 'hermes.run.steer', run_id: runId, accepted: true })
  }

  return createServer(async (request, response) => {
    const signal = signalFor(response)
    try {
      const supplied = Buffer.from(request.headers.authorization ?? '')
      check(supplied.length === authorized.length && timingSafeEqual(supplied, authorized), 401, 'Unauthorized')
      check(isReady(), 503, 'DSH is not ready')
      const path = request.url
      const method = request.method
      if (method === 'GET' && path === '/health') return json(response, 200, { status: 'healthy' })
      if (method === 'GET' && path === '/v1/capabilities') return json(response, 200, cap)
      if (method === 'POST' && (path === '/v1/runs' || path === '/v1/runs/lookup')) {
        return await admission(request, response, path.endsWith('/lookup'), signal)
      }
      const matches = runPath.exec(path)
      check(matches !== null, 404, 'Unknown endpoint')
      const [, runId, action] = matches
      if (method === 'GET' && action === undefined) return json(response, 200, runView(await recoverRun(runId, signal)))
      if (method === 'GET' && action === 'events') return await runEvents(request, response, runId, signal)
      if (method === 'POST' && action === 'stop') {
        const run = await readRun(runId, signal)
        if (active.has(run.status)) {
          check(run.revision === revision, 409, 'Original DSH configuration is required')
          await rpc('stop', { runId }, signal)
        }
        return json(response, 200, runView(await readRun(runId, signal)))
      }
      if (method === 'POST' && action === 'steer') return await steer(request, response, runId, signal)
      if (method === 'POST' && (action === 'approval' || action === 'question')) {
        return await reply(request, response, runId, action, signal)
      }
      throw new HttpError(405, 'Unsupported method')
    } catch (error) {
      if (signal.aborted) return
      if (response.headersSent) {
        response.destroy()
      } else if (error instanceof HttpError) {
        json(response, error.status, { error: error.message })
      } else {
        json(response, 503, { error: 'DSH run transport unavailable' })
      }
    }
  })
}
