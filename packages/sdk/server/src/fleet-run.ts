/** Stable Fleet run identity and receipts projected from the native Session log. */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { extractTextContent } from '@deepseek-ai/dsh-llm/message'

const prefix = 'fleet-run-'

export type FleetRunParams = { readonly key: string; readonly input: string }

export function fleetRunSessionId(key: string): SessionId {
  return brandString<SessionId>(prefix + createHash('sha256').update(key).digest('hex'))
}

export function requireOrdinarySession(sessionId: string): void {
  if (sessionId.startsWith(prefix)) throw new Error('Fleet run sessions require the Fleet run API')
}

function fleetRunKey(params: Record<string, unknown> | undefined): string {
  const key = params?.key
  if (typeof key !== 'string' || !/^[a-zA-Z0-9_:.@/-]{1,255}$/.test(key)) {
    throw new TypeError('Fleet run requires a valid operation key')
  }
  return key
}

export function fleetRunParams(params: Record<string, unknown> | undefined): FleetRunParams {
  const key = fleetRunKey(params)
  const input = params?.input
  if (typeof input !== 'string' || !input.trim() || Buffer.byteLength(input) > 1024 * 1024
    || params === undefined || Object.keys(params).some(field => field !== 'key' && field !== 'input')) {
    throw new TypeError('Fleet run requires only the operation key and its nonempty input')
  }
  return { key, input }
}

export function fleetRunAddress(params: Record<string, unknown> | undefined, allowCursor = false) {
  const runId = params?.runId
  if (params === undefined || typeof runId !== 'string' || !/^fleet-run-[a-f0-9]{64}$/.test(runId)
    || Object.keys(params).some(field => field !== 'runId' && !(allowCursor && field === 'after'))) {
    throw new TypeError('Fleet operation requires a native run ID')
  }
  const after = params.after === undefined ? -1 : params.after
  if (typeof after !== 'number' || !Number.isSafeInteger(after) || after < -1) {
    throw new TypeError('Fleet event cursor must be an integer greater than or equal to -1')
  }
  return { sessionId: brandString<SessionId>(runId), after }
}

/** A Fleet session has one submitted prompt. Queue removal never erases its original receipt. */
function fleetRunAdmission(events: readonly SessionEvent[]) {
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced' || event.data.target !== 'next-turn') continue
    const prompt = event.data.inserted.find(message => message.source.kind === 'user')
    if (prompt !== undefined) return { prompt, seq: event.seq }
  }
  return undefined
}

export function fleetRunPrompt(events: readonly SessionEvent[]): UserMessage | undefined {
  return fleetRunAdmission(events)?.prompt
}

type TerminalStatus = 'completed' | 'cancelled' | 'failed' | 'interrupted'
type FleetRunStatus = 'queued' | 'running' | TerminalStatus
type FleetRunEvent =
  | { seq: number; type: 'accepted'; messageId: string }
  | { seq: number; type: 'started' }
  | { seq: number; type: 'output'; text: string }
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
  const { prompt, seq } = admission
  const events: FleetRunEvent[] = [{ seq, type: 'accepted', messageId: prompt.id }]
  let status: FleetRunStatus = 'queued'
  let openTurn: number | undefined
  let owningTurn: number | undefined
  let output = ''
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
    }
  }
  return {
    kind: 'run' as const,
    runId: sessionId,
    messageId: prompt.id,
    status,
    output,
    cursor: events.at(-1)?.seq ?? seq,
    events: events.filter(event => event.seq > after),
  }
}

export function fleetRunReceipt(sessionId: SessionId, prompt: UserMessage) {
  return { kind: 'accepted' as const, runId: sessionId, messageId: prompt.id }
}

export function fleetRunInputMatches(prompt: UserMessage, input: string): boolean {
  const block = prompt.content[0]
  return prompt.content.length === 1 && block?.type === 'text' && block.text === input
}
