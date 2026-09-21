import { describe, it, expect, vi } from 'vitest';
import { createGoalTextGenerator } from '../../../resources/runtime/extensions/webview-browser-extension/agent/browser-choice-text.ts';

describe('Choice text helper uses the existing Pi model', () => {
  const input = () => ({ goal: 'Search for Paris', field: { role: 'textbox', name: 'Destination' }, signal: new AbortController().signal });
  it('uses modelRegistry.complete without a separate key or provider', async () => {
    const complete = vi.fn(async (..._args: any[]) => ({ content: [{ type: 'text', text: '{"text":"Paris"}' }], stopReason: 'stop', usage: { input: 45, output: 8 } }));
    const model = { id: 'current-session-model' };
    const generate = createGoalTextGenerator({ model, modelRegistry: { complete } })!;
    const request = input(); expect(await generate(request)).toEqual({ text: 'Paris', usage: { inputTokens: 45, outputTokens: 8 } });
    expect(complete).toHaveBeenCalledOnce();
    expect(complete.mock.calls[0][0]).toBe(model);
    expect(complete.mock.calls[0][2]).toMatchObject({ signal: request.signal, cacheRetention: 'none' });
    expect(complete.mock.calls[0][2]).not.toHaveProperty('apiKey');
  });
  it('does not guess when no current model/registry exists', () => {
    expect(createGoalTextGenerator()).toBeUndefined();
    expect(createGoalTextGenerator({ model: {} })).toBeUndefined();
  });
  it.each(['```json\n{"text":"Paris"}\n```', '{"text":null}', '{"text":"Paris","js":"evil()"}', '{"text":12}', 'not JSON'])('rejects invalid or incomplete model output %s', async raw => {
    const generate = createGoalTextGenerator({ model: {}, modelRegistry: { complete: async () => ({ content: [{ type: 'text', text: raw }] }) } })!;
    await expect(generate(input())).rejects.toThrow('invalid-generated-text');
  });
  it('rejects tool calls and aborts without returning generated content', async () => {
    const generate = createGoalTextGenerator({ model: {}, modelRegistry: { complete: async () => ({ content: [{ type: 'toolCall', name: 'shell' }] }) } })!;
    await expect(generate(input())).rejects.toThrow('text-generation-failed');
    const ac = new AbortController(); ac.abort();
    await expect(generate({ ...input(), signal: ac.signal })).rejects.toThrow('text-generation-aborted');
  });
});
