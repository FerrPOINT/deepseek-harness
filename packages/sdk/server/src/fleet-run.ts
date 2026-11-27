/** Stable Fleet run identity and receipts projected from the native Session log. */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { extractTextContent } from '@deepseek-ai/dsh-llm/message'
import { fleetInteractionRecord, type FleetInteraction, type FleetInteractionRecord } from './fleet-interactions.ts'

const prefix = 'fleet-run-'

interface FleetRunIdentity {
  readonly sessionId: string
  readonly deploymentId: string
  readonly revision: string
  readonly requestHash: string
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'fleet-run': { kind: 'user'; fleetRun: FleetRunIdentity }
  }
}

export interface FleetRunParams extends FleetRunIdentity {
  readonly key: string
  readonly input: string
}

export function fleetRunSessionId({ deploymentId, key }: FleetRunParams): SessionId {
  const hash = createHash('sha256').update(deploymentId).update('\0').update(key).digest('hex')
  return brandString<SessionId>(prefix + hash)
}

export function isFleetRunId(value: unknown): value is SessionId {
  return typeof value === 'string' && /^fleet-run-[a-f0-9]{64}$/.test(value)
}

export function requireOrdinarySession(sessionId: string): void {
  if (sessionId.startsWith(prefix)) throw new Error('Fleet run sessions require the Fleet run API')
}

const rpcIdentifier = /^[a-zA-Z0-9_:.@/-]{1,255}$/
const sha256 = /^[a-f0-9]{64}$/
const requestFields = new Set(['key', 'input', 'sessionId', 'deploymentId', 'revision', 'requestHash'])

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && rpcIdentifier.test(value)
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && sha256.test(value)
}

export function fleetRunParams(params: Record<string, unknown> | undefined): FleetRunParams {
  if (params === undefined || Object.keys(params).some(field => !requestFields.has(field))) {
    throw new TypeError('Invalid Fleet request fields')
  }
  const { key, input, sessionId, deploymentId, revision, requestHash } = params
  if (!isIdentifier(key) || !isIdentifier(sessionId) || !isIdentifier(deploymentId)
    || !isDigest(revision) || !isDigest(requestHash)
    || typeof input !== 'string' || !input.trim() || Buffer.byteLength(input) > 1024 * 1024) {
    throw new TypeError('Invalid Fleet request identity or input')
  }
  return { key, input, sessionId, deploymentId, revision, requestHash }
}

export function fleetRunAddress(params: Record<string, unknown> | undefined, allowCursor = false) {
  const runId = params?.runId
  if (params === undefined || !isFleetRunId(runId)
    || Object.keys(params).some(field => field !== 'runId' && !(allowCursor && field === 'after'))) {
    throw new TypeError('Fleet operation requires a native run ID')
  }
  const after = params.after === undefined ? -1 : params.after
  if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < -1) {
    throw new TypeError('Fleet event cursor must be an integer greater than or equal to -1')
  }
  return { sessionId: runId, after }
}

/** A Fleet session has one submitted prompt. Queue removal never erases its original receipt. */
function fleetRunAdmission(events: readonly SessionEvent[]) {
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced' || event.data.target !== 'next-turn') continue
    for (const prompt of event.data.inserted) {
      if ('fleetRun' in prompt.source) return { prompt, identity: prompt.source.fleetRun, seq: event.seq }
    }
  }
  return undefined
}

export function fleetRunAdmissionReceipt(runId: SessionId, events: readonly SessionEvent[], params: FleetRunParams) {
  const admission = fleetRunAdmission(events)
  if (admission === undefined) return undefined
  const { identity, prompt } = admission
  const block = prompt.content[0]
  if (identity.sessionId !== params.sessionId || identity.deploymentId !== params.deploymentId
    || identity.revision !== params.revision || identity.requestHash !== params.requestHash
    || prompt.content.length !== 1 || block?.type !== 'text' || block.text !== params.input) {
    return { kind: 'conflict' as const }
  }
  return fleetRunReceipt(runId, prompt.id, identity, true)
}

type TerminalStatus = 'completed' | 'cancelled' | 'failed' | 'interrupted'
type FleetRunStatus = 'queued' | 'running' | TerminalStatus
type FleetRunEvent =
  | { seq: number; type: 'accepted'; messageId: string }
  | { seq: number; type: 'started' }
  | { seq: number; type: 'output'; text: string }
  | FleetInteractionRecord
  | { seq: number; type: 'ended'; status: TerminalStatus; reason: string }

function terminalStatus(reason: string): TerminalStatus {
  switch (reason) {
    case 'completed': return 'completed'
    case 'aborted': return 'cancelled'
    case 'interrupted': return 'interrupted'
    default: return 'failed'
  }
}

export function fleetRunTerminal(status: FleetRunStatus): boolean {
  return status !== 'queued' && status !== 'running'
}

/** Read only the run's own turn. Native Session offsets are stable even when private events are omitted. */
export function fleetRunSnapshot(sessionId: SessionId, log: readonly SessionEvent[], after: number) {
  const admission = fleetRunAdmission(log)
  if (admission === undefined) return { kind: 'not-found' as const }
  const { prompt, identity, seq } = admission
  const events: FleetRunEvent[] = [{ seq, type: 'accepted', messageId: prompt.id }]
  let status: FleetRunStatus = 'queued'
  let openTurn: number | undefined
  let owningTurn: number | undefined
  let output = ''
  const pending = new Map<string, FleetInteraction>()
  for (const event of log.slice(seq + 1)) {
    if (event.type === 'turn/start') {
      openTurn = event.data.turn
    } else if (event.type === 'agent/inbox/spliced' && owningTurn === undefined
      && event.data.target === 'next-turn' && event.data.removedCount !== undefined) {
      if (event.data.outcome === 'canceled') {
        status = 'cancelled'
        events.push({ seq: event.seq, type: 'ended', status, reason: 'aborted' })
        break
      }
      if (openTurn !== undefined) {
        owningTurn = openTurn
        status = 'running'
        events.push({ seq: event.seq, type: 'started' })
      }
    } else if (event.type === 'assistant/message' && event.data.turn === owningTurn) {
      const text = extractTextContent(event.data.message.content)
      if (text !== '') {
        output = text
        events.push({ seq: event.seq, type: 'output', text })
      }
    } else if (event.type === 'turn/end') {
      openTurn = undefined
      if (event.data.turn === owningTurn) {
        const reason = event.data.reason.kind
        status = terminalStatus(reason)
        events.push({ seq: event.seq, type: 'ended', status, reason })
        break
      }
    } else if (owningTurn !== undefined) {
      const interaction = fleetInteractionRecord(event)
      if (interaction?.type === 'interaction-requested') {
        pending.set(interaction.interaction.requestId, interaction.interaction)
        events.push(interaction)
      } else if (interaction?.type === 'interaction-closed' && pending.delete(interaction.requestId)) {
        events.push(interaction)
      }
    }
  }
  return {
    kind: 'run' as const,
    runId: sessionId,
    messageId: prompt.id,
    sessionId: identity.sessionId,
    revision: identity.revision,
    status,
    output,
    pending: fleetRunTerminal(status) ? [] : [...pending.values()],
    cursor: events.at(-1)?.seq ?? seq,
    events: events.filter(event => event.seq > after),
  }
}

export function fleetRunReceipt(
  runId: SessionId, messageId: UserMessage['id'], identity: FleetRunIdentity, replayed: boolean,
) {
  return {
    kind: 'accepted' as const, runId, messageId, replayed, sessionId: identity.sessionId, revision: identity.revision,
  }
}
