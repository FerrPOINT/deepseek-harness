/** Stable Fleet run identity and receipts projected from the native Session log. */

import { createHash } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

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

/** A Fleet session has one submitted prompt. Queue removal never erases its original receipt. */
export function fleetRunPrompt(events: readonly SessionEvent[]): UserMessage | undefined {
  for (const event of events) {
    if (event.type !== 'agent/inbox/spliced' || event.data.target !== 'next-turn') continue
    const prompt = event.data.inserted.find(message => message.source.kind === 'user')
    if (prompt !== undefined) return prompt
  }
  return undefined
}

export function fleetRunReceipt(sessionId: SessionId, prompt: UserMessage) {
  return { kind: 'accepted' as const, runId: sessionId, messageId: prompt.id }
}

export function fleetRunInputMatches(prompt: UserMessage, input: string): boolean {
  const block = prompt.content[0]
  return prompt.content.length === 1 && block?.type === 'text' && block.text === input
}
