import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage, type ReasoningEffortId, type LlmModelReasoningInfo } from '@deepseek-ai/dsh-llm'
import PermissionPresetService from '@deepseek-ai/dsh-permission-presets'
import SandboxPolicyService from '@deepseek-ai/dsh-sandbox-policy'
import ShellExecutor from '@deepseek-ai/dsh-shell'
import { ApprovalService } from '@deepseek-ai/dsh-user-approval'
import UserQuestions from '@deepseek-ai/dsh-user-questions'
import { type SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import * as JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import type { JsonRpcTransportPeer, SessionEventNotification } from '@deepseek-ai/dsh-sdk-protocol'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { HarnessSdkJsonRpcServer } from '../src/index.ts'
import { fleetHttpServer } from '../src/fleet/http.mjs'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

function fleetCommand(key: string, input = 'original input') {
  return {
    key, input, sessionId: 'fleet:fixture-chat', deploymentId: 'fixture-alpha',
    revision: 'b'.repeat(64), requestHash: 'c'.repeat(64),
  }
}

async function storageRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sdk-resume-'))
  cleanups.push(() => rm(root, { recursive: true, force: true }))
  return root
}

async function runtime(root: string, persistence = true, reasoning?: LlmModelReasoningInfo) {
  const ctx = new Context()
  cleanups.push(() => ctx.fiber.dispose())
  await mountAgentLoopTestDependencies(ctx)
  if (persistence) await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = new MockAdapter([textResponse('remembered')], reasoning)
  ctx.llm.registerAdapter(['mock'], adapter)
  const events: SessionEventNotification[] = []
  const transport: JsonRpcTransportPeer = {
    request: async () => { throw new Error('unexpected server request') },
    notify: (method, params) => {
      if (method === 'session.event') events.push(params as SessionEventNotification)
    },
  }
  const server = new HarnessSdkJsonRpcServer(ctx, transport)
  cleanups.push(() => server.shutdown().then(() => {}))
  return { ctx, server, adapter, events }
}

async function initialized(root: string) {
  const result = await runtime(root)
  await result.server.initialize({ cwd: root, provider: 'mock', model: 'mock' })
  return result
}

/** The resumed model only returns text; permission state still uses the real services. */
class UnusedShell extends ShellExecutor {
  static inject = ['sandboxPolicy']
  override get sandboxMode() { return this.ctx.sandboxPolicy.defaultMode }
  override resolve(): never { throw new Error('Unexpected shell resolution') }
  override execute(): never { throw new Error('Unexpected shell execution') }
}

async function withPermissions(root: string) {
  const result = await initialized(root)
  await result.ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access', workspaceRoot: root })
  await result.ctx.plugin(UnusedShell)
  await result.ctx.plugin(ApprovalService, { policy: 'never' })
  await result.ctx.plugin(PermissionPresetService)
  return result
}

describe('SDK persisted session resume', () => {
  it.each([undefined, 'danger-full-access'])('applies persisted or explicit permissions before resumed execution: %s', async (permissionMode) => {
    const root = await storageRoot()
    const sessionId = brandString<SessionId>('saved-permissions')
    const first = await withPermissions(root)
    await first.server.prompt({ sessionId, contentBlocks: [{ type: 'text', text: 'remember' }] })
    await first.server.wait({ sessionId })
    first.ctx.permissionPresets.set(first.ctx.agents.get(sessionId)!.session, 'workspace-write')
    await first.server.shutdown()
    await first.ctx.fiber.dispose()

    const second = await withPermissions(root)
    const modes: string[] = []
    // A plugin can queue work while the restored Agent is being published.
    second.ctx.on('agent/created', ({ agent }) => {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text: 'continue during publication' }], source: { kind: 'user' },
      }))
    })
    second.ctx.on('agent/pre-step', (input, next) => {
      modes.push(second.ctx.sandboxPolicy.resolve({ session: input.agent.session }).mode)
      return next()
    })
    await second.server.handleRequest('session/resume', { sessionId, permissionMode })
    await second.server.wait({ sessionId })
    const expected = permissionMode ?? 'workspace-write'
    const session = second.ctx.agents.get(sessionId)!.session
    expect(modes).toEqual([expected])
    expect(second.ctx.permissionPresets.current(session)).toBe(expected)
    expect(second.ctx.approval.overrideOf(session)).toBe(permissionMode === undefined ? 'ask' : 'never')
    expect(second.adapter.requests).toHaveLength(1)
    await second.server.shutdown()
    await second.ctx.fiber.dispose()

    const third = await withPermissions(root)
    await third.server.resume({ sessionId })
    expect(third.ctx.permissionPresets.current(third.ctx.agents.get(sessionId)!.session)).toBe(expected)
    expect(third.ctx.sandboxPolicy.defaultMode).toBe('danger-full-access')
    expect(third.adapter.requests).toHaveLength(0)
  })

  it('rejects unsupported permission overrides before opening history and permits retry', async () => {
    const root = await storageRoot()
    const { ctx, server } = await initialized(root)
    const open = vi.spyOn(ctx.sessionPersistence, 'open')
    await expect(server.resume({ sessionId: 'saved', permissionMode: 'danger-full-access' }))
      .rejects.toThrow('requires the permission-presets service')
    await ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access', workspaceRoot: root })
    await ctx.plugin(UnusedShell)
    await ctx.plugin(ApprovalService, { policy: 'never' })
    await ctx.plugin(PermissionPresetService)
    await expect(server.resume({ sessionId: 'saved', permissionMode: 'unknown' })).rejects.toThrow('unknown preset')
    expect(open).not.toHaveBeenCalled()
    expect(ctx.agents.list()).toHaveLength(0)
    await expect(server.resume({ sessionId: 'saved' })).rejects.toThrow()
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed permission overrides at the wire boundary', async () => {
    const { server } = await initialized(await storageRoot())
    for (const permissionMode of ['', null, 17, true, {}]) {
      await expect(server.handleRequest('session/resume', { sessionId: 'saved', permissionMode }))
        .rejects.toThrow('permissionMode must be a non-empty string')
    }
  })

  it('rejects unknown resume fields before restoring a session', async () => {
    const { server } = await initialized(await storageRoot())
    const resume = vi.spyOn(server, 'resume')
    const params = { sessionId: 'saved', permission_mode: 'read-only' }
    await expect(server.handleRequest('session/resume', params)).rejects.toThrow('permission_mode')
    expect(resume).not.toHaveBeenCalled()
  })

  it('rejects independent subagent restoration before opening or repairing its log', async () => {
    const root = await storageRoot()
    const { ctx, server } = await initialized(root)
    const child = await ctx.agents.create({
      sessionId: brandString<SessionId>('saved-child'),
      meta: { origin: 'subagent', parentSession: brandString<SessionId>('creator'), cwd: root },
    })
    child.agent.session.append('turn/start', { turn: 1 })
    await ctx.sessions.flush(child.agent.session)
    await child.dispose()
    const resume = vi.spyOn(ctx.agents, 'resume')
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(server.resume({ sessionId: 'saved-child' })).rejects.toThrow('resume its root session instead')
    }
    expect(resume).not.toHaveBeenCalled()
    expect(ctx.agents.get(brandString<SessionId>('saved-child'))).toBeUndefined()
    await expect(server.shutdown()).resolves.toEqual({})
  })

  it.each([
    { model: 'mock', effort: undefined, expected: 'high' },
    { model: 'other', effort: undefined, expected: undefined },
    { model: 'mock', effort: 'low', expected: 'low' },
  ])('applies the initialized route and effort on resume: $model / $effort', async ({ model, effort, expected }) => {
    const root = await storageRoot()
    const first = await initialized(root)
    await first.server.prompt({ sessionId: 'saved-effort', contentBlocks: [{ type: 'text', text: 'remember' }] })
    await first.server.wait({ sessionId: 'saved-effort' })
    first.ctx.agents.get(brandString<SessionId>('saved-effort'))!.model.select({
      provider: 'mock', model: 'mock', reasoningEffort: brandString<ReasoningEffortId>('high'),
    })
    await first.server.shutdown()
    await first.ctx.fiber.dispose()

    const second = await runtime(root, true, {
      efforts: [{ id: brandString<ReasoningEffortId>('high'), name: 'High' }, { id: brandString<ReasoningEffortId>('low'), name: 'Low' }],
    })
    await second.server.initialize({
      cwd: root, provider: 'mock', model,
      ...effort === undefined ? {} : { reasoningEffort: brandString<ReasoningEffortId>(effort) },
    })
    await second.server.resume({ sessionId: 'saved-effort' })
    expect(second.ctx.agents.get(brandString<SessionId>('saved-effort'))!.model.current()).toEqual({
      provider: 'mock', model,
      ...expected === undefined ? {} : { reasoningEffort: expected },
    })
  })

  it('restores due reminders through the SDK owner after initialization and shares client resume', async () => {
    const root = await storageRoot()
    const first = await initialized(root)
    await first.server.prompt({ sessionId: 'saved', contentBlocks: [{ type: 'text', text: 'original' }] })
    await first.server.wait({ sessionId: 'saved' })
    await first.server.shutdown()
    await first.ctx.fiber.dispose()

    const { ctx, server, adapter } = await runtime(root)
    const fallback = vi.fn(async () => { throw new Error('must not activate through the Web controller') })
    const restoring = ctx.waterfall('schedule/resolve-agent', brandString<SessionId>('saved'), fallback)
    expect(ctx.agents.list()).toHaveLength(0)
    const actualOpen = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
    const opened = Promise.withResolvers<undefined>()
    const gate = Promise.withResolvers<undefined>()
    const open = vi.spyOn(ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      const handle = await actualOpen(...args)
      opened.resolve(undefined)
      await gate.promise
      return handle
    })
    try {
      await server.initialize({ cwd: tmpdir(), provider: 'mock', model: 'reminder-model', maxTokens: 1234 })
      await opened.promise
      await expect(server.resume({ sessionId: 'saved', permissionMode: 'danger-full-access' }))
        .rejects.toThrow('already restored by a reminder')
      const resuming = server.resume({ sessionId: 'saved' })
      const anotherReminder = ctx.waterfall('schedule/resolve-agent', brandString<SessionId>('saved'), fallback)
      gate.resolve(undefined)
      const [agent, sameAgent] = await Promise.all([restoring, anotherReminder, resuming])
      expect(sameAgent).toBe(agent)
      expect(open).toHaveBeenCalledTimes(1)
      expect(fallback).not.toHaveBeenCalled()
      expect(agent.session.header.cwd).toBe(root)
      await server.prompt({ sessionId: 'saved', contentBlocks: [{ type: 'text', text: 'scheduled reminder' }] })
      await server.wait({ sessionId: 'saved' })
      expect(adapter.requests[0]).toMatchObject({ model: 'reminder-model', maxTokens: 1234 })
      await expect(server.resume({ sessionId: 'saved' })).rejects.toThrow('already open')
      await server.shutdown()
      expect(ctx.agents.list()).toHaveLength(0)
    } finally {
      gate.resolve(undefined)
    }
  })

  it('reuses an SDK-owned Session for reminders and releases failed reminder restoration for retry', async () => {
    const { ctx, server } = await initialized(await storageRoot())
    const fallback = vi.fn(async () => { throw new Error('unexpected fallback') })
    const restore = () => ctx.waterfall('schedule/resolve-agent', brandString<SessionId>('saved'), fallback)
    await expect(restore()).rejects.toThrow()
    await server.prompt({ sessionId: 'saved', contentBlocks: [{ type: 'text', text: 'create after failed reminder' }] })
    await server.wait({ sessionId: 'saved' })
    const agent = ctx.agents.get(brandString<SessionId>('saved'))
    await expect(restore()).resolves.toBe(agent)
    await expect(server.resume({ sessionId: 'saved' })).rejects.toThrow('already open')
    expect(fallback).not.toHaveBeenCalled()
  })

  it('releases a reminder waiting for initialization when the SDK shuts down', async () => {
    const { ctx, server } = await runtime(await storageRoot())
    const restoring = ctx.waterfall('schedule/resolve-agent', brandString<SessionId>('saved'), async () => {
      throw new Error('unexpected fallback')
    })
    const rejected = expect(restoring).rejects.toThrow('shutting down')
    await server.shutdown()
    await rejected
    expect(ctx.agents.list()).toHaveLength(0)
  })

  it('returns one durable Fleet run across concurrent submission and a runtime restart', async () => {
    const root = await storageRoot()
    const first = await initialized(root)
    const key = 'fleet-fixture:one'
    const command = fleetCommand(key)

    await expect(first.server.handleRequest('fleet/run/lookup', command)).resolves.toEqual({ kind: 'not-found' })
    const [accepted, concurrent] = await Promise.all([
      first.server.handleRequest('fleet/run/submit', command),
      first.server.handleRequest('fleet/run/submit', command),
    ])
    expect(accepted).toEqual({
      kind: 'accepted', runId: expect.any(String), messageId: expect.any(String),
      sessionId: command.sessionId, revision: command.revision, replayed: false,
    })
    const replayed = { ...(accepted as object), replayed: true }
    expect(concurrent).toEqual(replayed)
    expect(first.ctx.agents.list()).toHaveLength(1)
    const sessionId = first.ctx.agents.list()[0]!.session.id
    await first.server.wait({ sessionId })
    expect(first.adapter.requests).toHaveLength(1)
    const completed = await first.server.handleRequest('fleet/run/get', { runId: sessionId }) as {
      events: { seq: number; type: string }[]
    }
    expect(completed).toMatchObject({ kind: 'run', status: 'completed', output: 'remembered' })
    expect(completed.events.map(event => event.type)).toEqual(['accepted', 'started', 'output', 'ended'])
    const after = completed.events[1]!.seq
    await expect(first.server.handleRequest('fleet/run/get', { runId: sessionId, after }))
      .resolves.toMatchObject({ events: completed.events.slice(2) })
    await first.server.shutdown()
    await first.ctx.fiber.dispose()

    const restarted = await initialized(root)
    await expect(restarted.server.handleRequest('fleet/run/get', { runId: sessionId })).resolves.toEqual(completed)
    await expect(restarted.server.handleRequest('fleet/run/recover', { runId: sessionId })).resolves.toEqual(completed)
    await expect(restarted.server.handleRequest('fleet/run/lookup', command)).resolves.toEqual(replayed)
    await expect(restarted.server.handleRequest('fleet/run/lookup', { ...command, input: 'changed input' }))
      .resolves.toEqual({ kind: 'conflict' })
    await expect(restarted.server.handleRequest('fleet/run/submit', command)).resolves.toEqual(replayed)
    for (const changed of [
      { input: 'changed input' }, { sessionId: 'fleet:other-chat' },
      { requestHash: 'd'.repeat(64) }, { revision: 'e'.repeat(64) },
    ]) {
      await expect(restarted.server.handleRequest('fleet/run/submit', { ...command, ...changed }))
        .resolves.toEqual({ kind: 'conflict' })
    }
    await expect(restarted.server.prompt({ sessionId, contentBlocks: [{ type: 'text', text: 'extra prompt' }] }))
      .rejects.toThrow('Fleet run sessions require the Fleet run API')
    expect(restarted.ctx.agents.list()).toHaveLength(0)
    expect(restarted.adapter.requests).toHaveLength(0)

    const otherInstance = await initialized(await storageRoot())
    await expect(otherInstance.server.handleRequest('fleet/run/lookup', command))
      .resolves.toEqual({ kind: 'not-found' })
    const otherAccepted = await otherInstance.server.handleRequest('fleet/run/submit', {
      ...command, deploymentId: 'fixture-beta',
    })
    expect(otherAccepted).toMatchObject({ kind: 'accepted' })
    expect(otherAccepted).not.toMatchObject({ runId: sessionId })
    await expect(otherInstance.server.handleRequest('fleet/run/stop', { runId: sessionId }))
      .resolves.toEqual({ kind: 'not-found' })
  })

  it('serves the common Fleet HTTP acceptance, status, SSE replay and exact controls', async () => {
    const root = await storageRoot()
    const first = await runtime(root)
    const adapter = new MockAdapter([textResponse('http result'), 'hang'])
    first.ctx.llm.registerAdapter(['http-fixture'], adapter)
    await first.server.initialize({ cwd: root, provider: 'http-fixture', model: 'http-fixture' })
    const revision = 'b'.repeat(64)
    const token = 'http-fixture-' + 'a'.repeat(43)
    const config = { token, revision, deploymentId: 'fixture-alpha', provider: 'http-fixture', model: 'http-fixture' }
    // Exercise the real SDK in-process. No imitation of its persistence, cursors, or cancellation.
    let sdk = first.server
    const http = fleetHttpServer(config, { request: (method: string, params: Record<string, unknown>) =>
      sdk.handleRequest(method, params) }, () => true)
    cleanups.push(async () => { http.close(); http.closeAllConnections() })
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const address = http.address()
    if (address === null || typeof address === 'string') throw new Error('HTTP fixture was not bound')
    const base = 'http://127.0.0.1:' + address.port
    const auth = { Authorization: 'Bearer ' + token }
    const request = { input: 'run once', session_id: 'fleet:fixture-chat', model: 'http-fixture' }
    const post = (path: string, key: string, value = request) => fetch(base + path, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': key, 'X-DSH-Deployment-Revision': revision, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })

    expect((await fetch(base + '/v1/capabilities')).status).toBe(401)
    expect(await (await fetch(base + '/v1/capabilities', { headers: auth })).json())
      .toMatchObject({ platform: 'dsh', deployment_id: 'fixture-alpha', deployment_revision: revision })
    expect((await post('/v1/runs/lookup', 'key-one')).status).toBe(404)
    const submissions = await Promise.all([post('/v1/runs', 'key-one'), post('/v1/runs', 'key-one')])
    expect(submissions.map(response => response.status)).toEqual([202, 202])
    expect(submissions.map(response => response.headers.get('x-hermes-session-id')))
      .toEqual([request.session_id, request.session_id])
    const receipts = await Promise.all(submissions.map(response => response.json()))
    expect(receipts.filter(receipt => receipt.replayed)).toHaveLength(1)
    expect(receipts[0].run_id).toBe(receipts[1].run_id)
    expect((await post('/v1/runs', 'key-one', { ...request, session_id: 'fleet:other-chat' })).status).toBe(409)
    const run = '/v1/runs/' + receipts[0].run_id
    const events = await (await fetch(base + run + '/events', { headers: auth })).text()
    expect(events).toContain('event: run.created')
    expect(events).toContain('event: run.completed')
    expect(events).toContain('http result')
    const cursor = events.match(/id: ([0-9]+)/)?.[1] ?? ''
    expect(cursor).not.toBe('')
    expect(await (await fetch(base + run + '/events', {
      headers: { ...auth, 'Last-Event-ID': cursor },
    })).text()).not.toContain('event: run.created')
    expect(adapter.requests).toHaveLength(1)

    const second = await (await post('/v1/runs', 'key-two')).json()
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(2))
    const stopped = await fetch(base + '/v1/runs/' + second.run_id + '/stop', { method: 'POST', headers: auth })
    expect(stopped.status).toBe(200)
    expect(await stopped.json()).toMatchObject({ run_id: second.run_id, status: 'cancelled' })

    await first.server.shutdown()
    await first.ctx.fiber.dispose()
    const restarted = await runtime(root)
    const afterRestart = new MockAdapter([])
    restarted.ctx.llm.registerAdapter(['http-fixture'], afterRestart)
    sdk = restarted.server
    await sdk.initialize({ cwd: root, provider: 'http-fixture', model: 'http-fixture' })
    expect(await (await post('/v1/runs/lookup', 'key-one')).json())
      .toMatchObject({ run_id: receipts[0].run_id, status: 'completed', replayed: true })
    expect(await (await fetch(base + run, { headers: auth })).json())
      .toMatchObject({ status: 'completed', output: 'http result', completed: true })
    expect(afterRestart.requests).toHaveLength(0)
  })

  it('routes approval and question replies to their exact DSH run and drops stopped requests', async () => {
    const root = await storageRoot()
    const { ctx, server, adapter } = await runtime(root)
    await ctx.plugin(UserQuestions)
    await ctx.plugin(ApprovalService, { policy: 'ask' })
    const reply = { answers: [{ id: 'format', selected: ['JSON'] }] }
    const outcomes: unknown[] = []
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
      const question = { id: 'format', question: 'Which format?', options: [{ label: 'JSON' }] }
      try {
        const answer = await ctx.userQuestions.ask({ agent, questions: [question], signal })
        outcomes.push(answer)
      } catch (error: unknown) {
        if (!signal.aborted) throw error
        return next()
      }
      if (messages.some(message => message.content.some(block => block.type === 'text' && block.text === 'alpha'))) {
        outcomes.push(await ctx.approval.request({ agent, toolName: 'fixture-write', reason: 'Save the report?', signal }))
      }
      return next()
    })
    await server.initialize({
      cwd: root, provider: 'mock', model: 'mock', approvalRequests: true, capabilities: { userQuestions: true },
    })
    const revision = 'b'.repeat(64)
    const token = 'http-fixture-' + 'a'.repeat(43)
    const config = { token, revision, deploymentId: 'fixture-alpha', provider: 'mock', model: 'mock' }
    const http = fleetHttpServer(config, { request: (method: string, params: Record<string, unknown>) =>
      server.handleRequest(method, params) }, () => true)
    cleanups.push(async () => { http.close(); http.closeAllConnections() })
    http.listen(0, '127.0.0.1')
    await once(http, 'listening')
    const address = http.address()
    if (address === null || typeof address === 'string') throw new Error('HTTP fixture was not bound')
    const base = 'http://127.0.0.1:' + address.port
    const auth = { Authorization: 'Bearer ' + token }
    const get = (path: string) => fetch(base + path, { headers: auth })
    const post = (path: string, value: object, key = '') => fetch(base + path, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': key, 'X-DSH-Deployment-Revision': revision, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    })
    const submit = async (key: string) => {
      const response = await post('/v1/runs', { input: key, session_id: 'fleet:fixture-chat' }, key)
      expect(response.status).toBe(202)
      return '/v1/runs/' + (await response.json()).run_id
    }
    const alpha = await submit('alpha')
    const beta = await submit('beta')
    const alphaQ = await vi.waitFor(async () => {
      const state = await (await get(alpha)).json()
      expect(state, 'run waiting for its native question').toMatchObject({ questions: [expect.any(Object)] })
      return state.questions[0].request_id as string
    })
    const betaQ = await vi.waitFor(async () => {
      const state = await (await get(beta)).json()
      expect(state, 'run waiting for its native question').toMatchObject({ questions: [expect.any(Object)] })
      return state.questions[0].request_id as string
    })
    expect(alphaQ).not.toBe(betaQ)
    expect((await post(beta + '/question', { request_id: alphaQ, response: reply })).status).toBe(409)
    expect((await post(alpha + '/question', {
      request_id: alphaQ, response: { answers: [{ id: 'format', selected: ['unavailable'] }] },
    })).status).toBe(400)
    expect((await post(alpha + '/question', { request_id: alphaQ, response: reply })).status).toBe(200)
    expect((await post(alpha + '/question', { request_id: alphaQ, response: reply })).status).toBe(409)
    const approval = await vi.waitFor(async () => {
      const state = await (await get(alpha)).json()
      expect(state).toMatchObject({
        status: 'waiting_for_approval', approval: { prompt: 'Save the report?', choices: ['once', 'deny'] },
      })
      return state.approval.request_id as string
    })
    const action = { request_id: approval, choice: 'once', resolve_all: false }
    expect((await post(beta + '/approval', action)).status).toBe(409)
    expect((await post(alpha + '/approval', { ...action, choice: 'always' })).status).toBe(400)
    expect((await post(alpha + '/approval', { ...action, resolve_all: true })).status).toBe(400)
    expect((await post(alpha + '/approval', action)).status).toBe(200)
    await server.wait({ sessionId: alpha.split('/').at(-1)! })
    const completed = await (await get(alpha + '/events')).text()
    expect(completed).toContain('event: question.request')
    expect(completed).toContain('event: question.closed')
    expect(completed).toContain('event: approval.request')
    expect(completed).toContain('event: approval.closed')
    expect(completed).toContain('event: run.completed')
    expect(completed).not.toContain(betaQ)
    expect((await fetch(base + beta + '/stop', { method: 'POST', headers: auth })).status).toBe(200)
    expect((await post(beta + '/question', { request_id: betaQ, response: reply })).status).toBe(409)
    const cancelled = await (await get(beta + '/events')).text()
    expect(cancelled).toContain('event: question.closed')
    expect(cancelled).toContain('event: run.cancelled')
    expect(outcomes).toEqual([reply, 'allowed-once'])
    expect(adapter.requests).toHaveLength(1)
  })

  it('stops only the addressed live Fleet run and persists its cancellation', async () => {
    const root = await storageRoot()
    const first = await runtime(root)
    const adapter = new MockAdapter(['hang', 'hang'])
    first.ctx.llm.registerAdapter(['hanging'], adapter)
    await first.server.initialize({ cwd: root, provider: 'hanging', model: 'hanging' })
    const submit = async (key: string) =>
      await first.server.handleRequest('fleet/run/submit', fleetCommand(key, key)) as { runId: string }
    const alpha = await submit('alpha')
    const beta = await submit('beta')
    await vi.waitFor(() => expect(adapter.requests).toHaveLength(2))
    const stopped = await first.server.handleRequest('fleet/run/stop', { runId: alpha.runId })
    expect(stopped).toMatchObject({ kind: 'run', runId: alpha.runId, status: 'cancelled' })
    await expect(first.server.handleRequest('fleet/run/get', { runId: beta.runId }))
      .resolves.toMatchObject({ kind: 'run', status: 'running' })
    await expect(first.server.handleRequest('fleet/run/stop', { runId: alpha.runId })).resolves.toEqual(stopped)
    await first.server.handleRequest('fleet/run/stop', { runId: beta.runId })
    await first.server.shutdown()
    await first.ctx.fiber.dispose()

    const restarted = await initialized(root)
    await expect(restarted.server.handleRequest('fleet/run/get', { runId: alpha.runId })).resolves.toEqual(stopped)
    expect(restarted.adapter.requests).toHaveLength(0)
  })

  it.each(['recover-running', 'recover-queued', 'stop-queued'] as const)(
    'restores the native durable Fleet prefix for %s',
    async (scenario) => {
      const first = await initialized(await storageRoot())
      const { runId } = await first.server.handleRequest('fleet/run/submit', fleetCommand('restore')) as { runId: string }
      const sessionId = brandString<SessionId>(runId)
      await first.server.wait({ sessionId })
      const live = first.ctx.agents.get(sessionId)!.session
      const second = await initialized(await storageRoot())

      // Use the actual native log and only the prefix durable at the simulated crash.
      const log = live.snapshotEvents()
      const boundary = log.find(event => scenario === 'recover-running'
        ? event.type === 'step/start'
        : event.type === 'agent/inbox/spliced' && event.data.inserted.some(message => message.source.kind === 'user'))!
      await using writer = await second.ctx.sessionPersistence.create(live.header)
      await writer.append(log.slice(0, boundary.seq + 1))
      await writer.flush()
      await writer.close()
      const method = scenario === 'stop-queued' ? 'fleet/run/stop' : 'fleet/run/recover'
      const restored = await second.server.handleRequest(method, { runId })
      if (scenario === 'recover-queued') {
        await second.server.wait({ sessionId })
        await expect(second.server.handleRequest('fleet/run/get', { runId }))
          .resolves.toMatchObject({ status: 'completed', runId })
        expect(second.adapter.requests).toHaveLength(1)
      } else {
        expect(restored).toMatchObject({ status: scenario === 'stop-queued' ? 'cancelled' : 'interrupted', runId })
        expect(second.adapter.requests).toHaveLength(0)
      }
    },
  )

  it('restores a non-main identity, preserves history and origin, and appends a new turn', async () => {
    const root = await storageRoot()
    const first = await initialized(root)
    await first.server.prompt({ sessionId: 'saved-session', contentBlocks: [{ type: 'text', text: 'remember kiwi' }] })
    await first.server.wait({ sessionId: 'saved-session' })
    const original = first.ctx.agents.get(brandString<SessionId>('saved-session'))!.session.snapshotEvents()
    await first.server.shutdown()
    await first.ctx.fiber.dispose()

    const second = await runtime(root)
    await second.server.initialize({ cwd: tmpdir(), provider: 'mock', model: 'resumed-model', maxTokens: 123 })
    await expect(second.server.handleRequest('session/resume', { sessionId: 'saved-session' }))
      .resolves.toEqual({})
    const restored = second.ctx.agents.get(brandString<SessionId>('saved-session'))!.session
    expect(restored.header.cwd).toBe(root)
    expect(restored.snapshotEvents().slice(0, original.length)).toEqual(original)
    expect(restored.snapshotEvents().slice(original.length)).toMatchObject([
      { type: 'session/end-seed' },
      { type: 'model/selection', data: { provider: 'mock', model: 'resumed-model' } },
    ])
    expect(second.adapter.requests).toHaveLength(0)
    expect(second.events).toEqual([
      { sessionId: 'saved-session', event: restored.snapshotEvents().at(-1) },
    ])
    await second.server.prompt({ sessionId: 'saved-session', contentBlocks: [{ type: 'text', text: 'what did I say?' }] })
    await second.server.wait({ sessionId: 'saved-session' })
    expect(second.events.length).toBeGreaterThan(0)
    expect(second.events.every(notification => notification.event.seq > original.at(-1)!.seq)).toBe(true)
    const request = JSON.stringify(second.adapter.requests[0])
    expect(request).toContain('remember kiwi')
    expect(request).toContain('remembered')
    expect(request).toContain('what did I say?')
    expect(second.adapter.requests[0]).toMatchObject({ model: 'resumed-model', maxTokens: 123 })
    expect(restored.snapshotEvents().slice(0, original.length)).toEqual(original)
    expect(restored.snapshotEvents().filter(event => event.type === 'turn/end')).toHaveLength(2)
    await expect(second.server.resume({ sessionId: 'saved-session' })).rejects.toThrow('already open')
  })

  it('repairs an interrupted final turn before accepting new input', async () => {
    const root = await storageRoot()
    const first = await initialized(root)
    await first.server.prompt({ sessionId: 'interrupted', contentBlocks: [{ type: 'text', text: 'first turn' }] })
    await first.server.wait({ sessionId: 'interrupted' })
    await first.server.shutdown()
    const handle = await first.ctx.sessionPersistence.open(brandString<SessionId>('interrupted'), 'write')
    try {
      const events = (await handle.read()).events
      const last = events.at(-1)!
      await handle.append([
        { type: 'turn/start', data: { turn: 2 }, seq: SessionSeq(last.seq + 1), time: last.time + 1 },
        { type: 'step/start', data: { turn: 2, step: 1 }, seq: SessionSeq(last.seq + 2), time: last.time + 2 },
      ])
      await handle.flush()
    } finally {
      await handle.close()
    }
    await first.ctx.fiber.dispose()
    const second = await initialized(root)
    await second.server.resume({ sessionId: 'interrupted' })
    const restored = second.ctx.agents.get(brandString<SessionId>('interrupted'))!.session
    expect(restored.snapshotEvents().filter(event => event.type === 'turn/end').at(-1)).toMatchObject({
      type: 'turn/end', data: { turn: 2, reason: { kind: 'interrupted' } },
    })
    await second.server.prompt({ sessionId: 'interrupted', contentBlocks: [{ type: 'text', text: 'continue' }] })
    await second.server.wait({ sessionId: 'interrupted' })
    expect(restored.snapshotEvents().at(-1)).toMatchObject({
      type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } },
    })
  })

  it('rejects missing history and releases a failed resume for retry', async () => {
    const { ctx, server } = await initialized(await storageRoot())
    await expect(server.resume({ sessionId: 'missing' })).rejects.toThrow()
    await expect(server.resume({ sessionId: 'missing' })).rejects.toThrow()
    expect(ctx.agents.list()).toHaveLength(0)
    expect(ctx.sessions.get(brandString<SessionId>('missing'))).toBeUndefined()
  })

  it('shares pending restoration with a prompt and rejects duplicate resume', async () => {
    const root = await storageRoot()
    const first = await initialized(root)
    await first.server.prompt({ sessionId: 'saved', contentBlocks: [{ type: 'text', text: 'original' }] })
    await first.server.wait({ sessionId: 'saved' })
    await first.server.shutdown()
    await first.ctx.fiber.dispose()
    const { ctx, server } = await initialized(root)
    const actualOpen = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
    const gate = Promise.withResolvers<undefined>()
    const opened = Promise.withResolvers<undefined>()
    const open = vi.spyOn(ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      opened.resolve(undefined)
      await gate.promise
      return actualOpen(...args)
    })
    try {
      const restoring = server.resume({ sessionId: 'saved' })
      await opened.promise
      await expect(server.resume({ sessionId: 'saved' })).rejects.toThrow('already open or opening')
      const prompting = server.prompt({ sessionId: 'saved', contentBlocks: [{ type: 'text', text: 'followup' }] })
      gate.resolve(undefined)
      await restoring
      await prompting
      await server.wait({ sessionId: 'saved' })
      expect(open).toHaveBeenCalledTimes(1)
      expect(ctx.agents.list()).toHaveLength(1)
      await server.shutdown()
      expect(ctx.agents.list()).toHaveLength(0)
      await expect(server.resume({ sessionId: 'saved' })).rejects.toThrow('shutting down')
    } finally {
      gate.resolve(undefined)
    }
  })

  it('waits for pending restoration during shutdown and releases the restored Agent', async () => {
    const root = await storageRoot()
    const first = await initialized(root)
    await first.server.prompt({ sessionId: 'saved', contentBlocks: [{ type: 'text', text: 'original' }] })
    await first.server.wait({ sessionId: 'saved' })
    await first.server.shutdown()
    await first.ctx.fiber.dispose()
    const { ctx, server } = await initialized(root)
    const actualOpen = ctx.sessionPersistence.open.bind(ctx.sessionPersistence)
    const gate = Promise.withResolvers<undefined>()
    const opened = Promise.withResolvers<undefined>()
    vi.spyOn(ctx.sessionPersistence, 'open').mockImplementation(async (...args) => {
      opened.resolve(undefined)
      await gate.promise
      return actualOpen(...args)
    })
    try {
      const restoring = server.resume({ sessionId: 'saved' })
      await opened.promise
      const shutdown = server.shutdown()
      await expect(server.resume({ sessionId: 'another' })).rejects.toThrow('shutting down')
      gate.resolve(undefined)
      await Promise.all([restoring, shutdown])
      expect(ctx.agents.list()).toHaveLength(0)
    } finally {
      gate.resolve(undefined)
    }
  })

  it('rejects restoration when the profile has no persistence backend', async () => {
    const root = await storageRoot()
    const { ctx, server } = await runtime(root, false)
    await server.initialize({ cwd: root, provider: 'mock', model: 'mock' })
    await expect(server.resume({ sessionId: 'saved' })).rejects.toThrow('session persistence is not configured')
    expect(ctx.agents.list()).toHaveLength(0)
  })

  it('validates the wire identity and requires initialization', async () => {
    const { server } = await runtime(await storageRoot())
    for (const sessionId of [undefined, '', 17]) {
      await expect(server.handleRequest('session/resume', { sessionId })).rejects.toThrow('non-empty sessionId')
    }
    await expect(server.resume({ sessionId: 'saved' })).rejects.toThrow('not initialized')
  })
})
