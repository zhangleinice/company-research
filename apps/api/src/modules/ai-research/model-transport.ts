import { Agent } from 'undici';
/** The request AbortSignal remains the total deadline; transport timers must not expire first. */
export const modelTransportTimeouts = (timeoutMs: number) => ({
  headersTimeout: timeoutMs + 1000,
  bodyTimeout: timeoutMs + 1000,
});
export function modelTransport(timeoutMs: number) {
  const dispatcher = new Agent(modelTransportTimeouts(timeoutMs));
  const fetch: typeof globalThis.fetch = (input, init) =>
    globalThis.fetch(input, { ...init, dispatcher } as RequestInit & {
      dispatcher: Agent;
    });
  return { fetch, dispose: () => dispatcher.destroy() };
}
