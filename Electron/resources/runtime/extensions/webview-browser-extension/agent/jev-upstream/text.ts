/** Preserve the upstream text-helper messages while using the selected Pi model and auth. */
export function createUpstreamTextTransport(ctx: any) {
  if (!ctx?.model || typeof ctx.modelRegistry?.complete !== 'function') return undefined;
  const model = ctx.model, registry = ctx.modelRegistry;
  return async (body: any, signal: AbortSignal) => {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const system = messages.find((m: any) => m.role === 'system')?.content;
    const user = messages.find((m: any) => m.role === 'user')?.content;
    if (typeof system !== 'string' || typeof user !== 'string' || user.length > 64_000) throw new Error('text-model-invalid-request');
    const response = await registry.complete(model, {
      systemPrompt: system,
      messages: [{ role: 'user', content: [{ type: 'text', text: user }], timestamp: Date.now() }],
    }, {
      signal, cacheRetention: 'none',
      // Raw complete does not run the main agent's before_provider_request hooks.
      // In particular Flapcode rejects max_output_tokens. Do not inject a
      // provider-specific token limit here; deadline + parsed output bound the helper.
    });
    if (signal.aborted) throw new Error('aborted');
    if (!response || response.stopReason === 'error') {
      const message = String(response?.errorMessage ?? '');
      throw new Error(/unsupported parameter/i.test(message) ? 'text-model-unsupported-parameter' : 'text-model-provider-error');
    }
    if (['aborted', 'length'].includes(response.stopReason) || !Array.isArray(response.content)
      || response.content.some((p: any) => p.type === 'toolCall')) throw new Error('text-model-invalid-response');
    const text = response.content.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('');
    if (text.length > 12_000) throw new Error('text-model-output-budget');
    // Return the original helper's expected shape; its strict JSON validator remains authoritative.
    const input = response.usage?.input, output = response.usage?.output;
    const valid = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
    return { model: model.id, choices: [{ message: { content: text } }],
      ...(valid(input) && valid(output) ? { usage: { prompt_tokens: input, completion_tokens: output } } : {}) };
  };
}
