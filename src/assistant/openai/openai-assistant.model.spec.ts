import { Logger } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AssistantModelError, type ToolResult, type TurnEvent, type TurnRequest } from '../assistant-model'
import { OpenAiAssistantModel } from './openai-assistant.model'

type Params = { input: { type?: string; output?: string }[]; reasoning: { effort: string } }

/** A finished call that asked for these tools. */
function callsStep(names: string[], status: 'completed' | 'incomplete' = 'completed'): object[] {
  const output = names.map((name, index) => ({
    type: 'function_call',
    name,
    call_id: `call-${index}`,
    arguments: '{}',
    status,
  }))
  return [
    ...output.map(item => ({ type: 'response.output_item.done', item })),
    {
      type: status === 'completed' ? 'response.completed' : 'response.incomplete',
      response: { status, output, usage: { input_tokens: 1000, output_tokens: 50 }, incomplete_details: null },
    },
  ]
}

/** A finished call that wrote this text. */
function textStep(text: string): object[] {
  return [
    { type: 'response.output_text.delta', delta: text },
    {
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [{ type: 'message' }],
        usage: { input_tokens: 2000, output_tokens: 80 },
      },
    },
  ]
}

/** OpenAI's client as the adapter uses it: each call streams the next script; `hang` waits until it is aborted. */
function fakeClient(steps: { events: object[]; hang?: boolean }[]) {
  const params: Params[] = []
  const create = (body: Params, options: { signal: AbortSignal }) => {
    params.push(structuredClone(body))
    const step = steps[params.length - 1]
    return Promise.resolve(
      (async function* () {
        for (const event of step.events) yield event
        if (step.hang)
          await new Promise((_, reject) =>
            options.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            ),
          )
      })(),
    )
  }
  return { client: { responses: { create } }, params }
}

function model(steps: { events: object[]; hang?: boolean }[]) {
  const adapter = new OpenAiAssistantModel(new ConfigService({ OPENAI_API_KEY: 'test-key' }))
  const fake = fakeClient(steps)
  // The adapter builds its own OpenAI client; tests swap it for the scripted one.
  ;(adapter as unknown as { client: unknown }).client = fake.client
  return { adapter, params: fake.params }
}

function request(runTool: TurnRequest<string>['runTool'], signal = new AbortController().signal): TurnRequest<string> {
  return {
    instructions: 'Sos el asesor de la tienda.',
    history: [{ role: 'user', text: 'Busco una impresora' }],
    tools: [{ name: 'search_products', description: 'Busca', parameters: {} }],
    runTool,
    maxSteps: 6,
    maxOutputTokens: 2000,
    safetyId: 'conversation-1',
    signal,
  }
}

async function collect(turn: AsyncGenerator<TurnEvent<string>>): Promise<TurnEvent<string>[]> {
  const events: TurnEvent<string>[] = []
  for await (const event of turn) events.push(event)
  return events
}

describe('OpenAiAssistantModel', () => {
  beforeAll(() => jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined))

  it('runs at most four tool calls per step, together, and answers the rest with an error', async () => {
    const { adapter, params } = model([{ events: callsStep(['a', 'b', 'c', 'd', 'e']) }, { events: textStep('Listo') }])
    const ran: string[] = []
    let running = 0
    let together = 0
    const runTool = async (name: string): Promise<ToolResult<string>> => {
      ran.push(name)
      running += 1
      together = Math.max(together, running)
      await new Promise(resolve => setTimeout(resolve, 5))
      running -= 1
      return { output: { ok: name } }
    }
    await collect(adapter.runTurn(request(runTool)))
    expect(ran).toEqual(['a', 'b', 'c', 'd'])
    expect(together).toBe(4)
    const outputs = params[1].input.filter(item => item.type === 'function_call_output').map(item => item.output)
    expect(outputs).toEqual([
      '{"ok":"a"}',
      '{"ok":"b"}',
      '{"ok":"c"}',
      '{"ok":"d"}',
      '{"error":"Usá como máximo 4 herramientas por paso."}',
    ])
  })

  it('explains the cards it showed with less reasoning', async () => {
    const { adapter, params } = model([
      { events: callsStep(['search_products']) },
      { events: callsStep(['show_products']) },
      { events: textStep('Te mostramos dos opciones') },
    ])
    const runTool = (name: string): Promise<ToolResult<string>> =>
      Promise.resolve(name === 'show_products' ? { output: { shown: 2 }, display: 'cards' } : { output: {} })
    const events = await collect(adapter.runTurn(request(runTool)))
    expect(params.map(body => body.reasoning.effort)).toEqual(['medium', 'medium', 'low'])
    expect(events.filter(event => event.type === 'display')).toEqual([{ type: 'display', display: 'cards' }])
  })

  it('does not run a tool call cut by the output cap', async () => {
    const { adapter } = model([{ events: callsStep(['search_products'], 'incomplete') }])
    const runTool = jest.fn()
    await collect(adapter.runTurn(request(runTool)))
    expect(runTool).not.toHaveBeenCalled()
  })

  it('counts an estimate of what a call used when the customer leaves in the middle', async () => {
    const leave = new AbortController()
    const { adapter } = model([{ events: [{ type: 'response.output_text.delta', delta: 'x'.repeat(70) }], hang: true }])
    const turn = adapter.runTurn(request(() => Promise.resolve({ output: {} }), leave.signal))
    expect((await turn.next()).value).toEqual({ type: 'text', delta: 'x'.repeat(70) })
    const pending = turn.next()
    leave.abort()
    const usage = (await pending).value as TurnEvent<string>
    expect(usage).toMatchObject({ type: 'usage', outputTokens: 20 })
    expect(usage.type === 'usage' && usage.inputTokens).toBeGreaterThan(0)
    await expect(turn.next()).rejects.toThrow('aborted')
  })

  it('gives up a call that stops streaming, counting what it used', async () => {
    jest.useFakeTimers()
    try {
      const { adapter } = model([{ events: [{ type: 'response.output_text.delta', delta: 'Hola' }], hang: true }])
      const turn = adapter.runTurn(request(() => Promise.resolve({ output: {} })))
      expect((await turn.next()).value).toEqual({ type: 'text', delta: 'Hola' })
      const pending = turn.next()
      await jest.advanceTimersByTimeAsync(30_000)
      expect((await pending).value).toMatchObject({ type: 'usage', outputTokens: 2 })
      await expect(turn.next()).rejects.toBeInstanceOf(AssistantModelError)
    } finally {
      jest.useRealTimers()
    }
  })
})
