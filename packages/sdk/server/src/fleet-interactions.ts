import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ApprovalRequestParams, SdkUserQuestionRequest } from '@deepseek-ai/dsh-sdk-protocol'
import { appendPluginRecord, pluginRecordOf, type SessionEvent } from '@deepseek-ai/dsh-session'
import { parseHostAnswer } from './user-questions.ts'

export type FleetInteraction =
  | { kind: 'approval'; requestId: string; prompt: string }
  | { kind: 'question'; requestId: string; questions: PublicQuestion[] }

type PublicQuestion = Pick<SdkUserQuestionRequest['questions'][number], 'id' | 'question' | 'detail'
  | 'header' | 'options' | 'multiSelect'> & { allowCustom: boolean }

type ClosedInteraction = { requestId: string; kind: FleetInteraction['kind']; answered: boolean }

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:fleet/interaction-requested': FleetInteraction
    'plugin:fleet/interaction-closed': ClosedInteraction
  }
}

interface Waiting {
  readonly agent: Agent
  readonly interaction: FleetInteraction
  readonly validate: (value: unknown) => unknown
  settle(answered: boolean, value: unknown): void
}

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/

function indexed(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isQuestion(item: unknown): item is PublicQuestion {
  return indexed(item) && typeof item.id === 'string' && typeof item.question === 'string'
    && typeof item.allowCustom === 'boolean' && typeof item.multiSelect === 'boolean'
    && (item.detail === undefined || typeof item.detail === 'string')
    && (item.header === undefined || typeof item.header === 'string')
    && (item.options === undefined || Array.isArray(item.options) && item.options.every(option => indexed(option)
      && typeof option.label === 'string' && (option.description === undefined || typeof option.description === 'string')))
}

export function fleetInteractionRecord(event: SessionEvent) {
  const record = pluginRecordOf(event)
  if (record?.type !== 'plugin:fleet/interaction-requested' && record?.type !== 'plugin:fleet/interaction-closed') return
  const data = record.data
  if (!indexed(data) || typeof data.requestId !== 'string' || !uuid.test(data.requestId)
    || (data.kind !== 'approval' && data.kind !== 'question')) throw new TypeError('Invalid saved Fleet interaction')
  const { requestId, kind } = data
  if (record.type === 'plugin:fleet/interaction-closed' && typeof data.answered === 'boolean') {
    return { type: 'interaction-closed' as const, requestId, kind, answered: data.answered, seq: record.seq }
  }
  if (record.type === 'plugin:fleet/interaction-requested') {
    let interaction: FleetInteraction
    if (kind === 'approval' && typeof data.prompt === 'string') {
      interaction = { kind, requestId, prompt: data.prompt }
    } else if (kind === 'question' && Array.isArray(data.questions) && data.questions.every(isQuestion)) {
      interaction = { kind, requestId, questions: data.questions }
    } else throw new TypeError('Invalid saved Fleet request')
    return { type: 'interaction-requested' as const, interaction, seq: record.seq }
  }
  throw new TypeError('Invalid saved Fleet decision')
}

/** A decision is usable only while its original Agent is waiting for it. */
export class FleetInteractions {
  private readonly waiting = new Map<string, Waiting>()

  askApproval(agent: Agent, request: ApprovalRequestParams, signal: AbortSignal): Promise<unknown> {
    const prompt = request.reason?.trim() || 'Confirm ' + request.toolName
    if (Buffer.byteLength(prompt) > 16384) throw new TypeError('Approval prompt exceeds Fleet limits')
    return this.ask(agent, { kind: 'approval', requestId: randomUUID(), prompt }, signal, choice => {
      if (choice === 'once') return { outcome: 'allowed-once' }
      if (choice === 'deny') return { outcome: 'rejected' }
      throw new TypeError('Fleet approval allows one action or denial')
    })
  }

  askQuestion(agent: Agent, request: SdkUserQuestionRequest, signal: AbortSignal): Promise<unknown> {
    const questions: PublicQuestion[] = request.questions.map(
      ({ id, question, detail, header, options, multiSelect, intent }) => {
        const allowCustom = intent?.kind !== 'approval'
        const offered = intent?.kind === 'approval'
          ? options?.filter(option => option.label === intent.approve || option.label === intent.reject)
          : options
        return {
          id, question, allowCustom, multiSelect: multiSelect ?? false,
          ...(detail === undefined ? {} : { detail }),
          ...(header === undefined ? {} : { header }),
          ...(offered === undefined ? {} : { options: offered.map(({ label, description }) => ({
            label, ...(description === undefined ? {} : { description }),
          })) }),
        }
      },
    )
    if (Buffer.byteLength(JSON.stringify(questions)) > 49152) throw new TypeError('Questions exceed Fleet limits')
    return this.ask(agent, { kind: 'question', requestId: request.requestId, questions }, signal, value => {
      if (value !== null && typeof value === 'object' && 'cancelled' in value
        && value.cancelled === true && Object.keys(value).length === 1) return { cancelled: true }
      const answer = parseHostAnswer(value, questions.map(question => question.id))
      for (const entry of answer.answers) {
        const question = questions.find(question => question.id === entry.id)!
        const options = new Set(question.options?.map(option => option.label))
        const count = entry.selected.length + (entry.custom?.trim() ? 1 : 0)
        if (count === 0 || (!question.multiSelect && count > 1)
          || new Set(entry.selected).size !== entry.selected.length || entry.selected.some(label => !options.has(label))) {
          throw new TypeError('Selected answers must match the original question')
        }
        if (!question.allowCustom && (entry.custom !== undefined || entry.selected.length !== 1)) {
          throw new TypeError('This decision requires one of its named choices')
        }
      }
      return answer
    })
  }

  private ask(agent: Agent, interaction: FleetInteraction, signal: AbortSignal, validate: Waiting['validate']) {
    signal.throwIfAborted()
    if (agent.status !== 'running') throw new Error('Fleet run is not accepting interactions')
    const promise = Promise.withResolvers<unknown>()
    const { requestId, kind } = interaction
    const settle = (answered: boolean, value: unknown) => {
      if (!this.waiting.delete(requestId)) return
      signal.removeEventListener('abort', abort)
      try {
        appendPluginRecord(agent.session, 'plugin:fleet/interaction-closed', { kind, requestId, answered })
      } catch (error: unknown) {
        promise.reject(error)
        if (answered) throw error
        return
      }
      if (answered) promise.resolve(value)
      else promise.reject(value)
    }
    const abort = () => settle(false, signal.reason)
    this.waiting.set(requestId, { agent, interaction, validate, settle })
    signal.addEventListener('abort', abort, { once: true })
    try {
      appendPluginRecord(agent.session, 'plugin:fleet/interaction-requested', interaction)
    } catch (error: unknown) {
      settle(false, error)
    }
    return promise.promise
  }

  answer(agent: Agent, kind: FleetInteraction['kind'], requestId: unknown, response: unknown) {
    if (typeof requestId !== 'string' || !uuid.test(requestId)) return { kind: 'invalid-answer' as const }
    const pending = this.waiting.get(requestId)
    if (pending === undefined || pending.agent !== agent || pending.interaction.kind !== kind) {
      return { kind: 'not-pending' as const }
    }
    let answer: unknown
    try {
      answer = pending.validate(response)
    } catch {
      return { kind: 'invalid-answer' as const }
    }
    pending.settle(true, answer)
    return { kind: 'resolved' as const }
  }
}
