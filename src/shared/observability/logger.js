/**
 * Minimal structured JSON logger.
 *
 * No transport dependency: writes one JSON line per event to stdout/stderr.
 * Redacts secrets and common PII keys recursively. Keeps the API's existing
 * console boot messages working while giving requests, errors and money
 * actions a machine-searchable shape.
 */

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const configured = String(process.env.LOG_LEVEL ?? '').toLowerCase();
const isTest = process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
const defaultLevel = isTest ? 'silent' : 'info';
const threshold = LEVELS[configured] ?? LEVELS[defaultLevel] ?? LEVELS.info;

const SECRET_KEY = /(pass(word)?|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|otp|pin)$/i;
const PII_KEY = /(account(number)?|bankreference|card(number)?|email|phone|fullname|surname|address|kyc|dob|dateofbirth)$/i;
const MAX_DEPTH = 5;
const MAX_STRING = 2000;
const MAX_ARRAY = 50;

const redactValue = (value, depth = 0) => {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return '[truncated]';
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY).map((entry) => redactValue(entry, depth + 1));
  }
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      out[key] = '[redacted]';
    } else if (PII_KEY.test(key)) {
      out[key] = '[redacted]';
    } else {
      out[key] = redactValue(entry, depth + 1);
    }
  }
  return out;
};

const write = (level, event, fields = {}) => {
  if ((LEVELS[level] ?? LEVELS.info) < threshold) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...redactValue(fields),
  };
  const target = level === 'error' ? process.stderr : process.stdout;
  target.write(`${JSON.stringify(line)}\n`);
};

export const serializeError = (error) => ({
  name: error?.name ?? 'Error',
  message: String(error?.message ?? error ?? 'Unknown error').slice(0, MAX_STRING),
  code: typeof error?.code === 'string' ? error.code : undefined,
  statusCode: Number.isInteger(error?.statusCode) ? error.statusCode : undefined,
  stack: process.env.NODE_ENV === 'production' ? undefined : error?.stack,
});

export const logger = {
  debug: (event, fields) => write('debug', event, fields),
  info: (event, fields) => write('info', event, fields),
  warn: (event, fields) => write('warn', event, fields),
  error: (event, fields) => write('error', event, fields),
  redact: (value) => redactValue(value),
};

export default logger;
