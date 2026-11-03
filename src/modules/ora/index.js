/**
 * Public entry for the ora slice (AI assistant).
 * Context assembly reuses sibling read models; the LLM is a port so tests
 * never touch the provider. The key lives in env, never in code or logs.
 */
export { default, buildOraRouter } from './interface/Ora.routes.js';
export { buildSystemPrompt, startersForLevel, greetingFor } from './domain/Ora.persona.js';
