// Opt-in per-run output cap (POST /chat maxOutputTokens → CLAUDE_CODE_MAX_OUTPUT_TOKENS).
// Only the spawn of that one run gets the variable; absent field = env untouched.
const MIN = 256, MAX = 16384;

// undefined when the key is absent/undefined; the integer when valid; throws otherwise
// (so POST /chat answers 400 through its existing catch).
function parseMaxOutputTokens(body) {
  if (!body || body.maxOutputTokens === undefined) return undefined;
  const n = body.maxOutputTokens;
  if (typeof n !== "number" || !Number.isInteger(n) || n < MIN || n > MAX)
    throw new Error(`maxOutputTokens must be an integer ${MIN}..${MAX}`);
  return n;
}

// New env object with the cap set when n is defined; the same env reference otherwise.
function applyMaxOutputTokens(env, n) {
  if (n === undefined) return env;
  return { ...env, CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(n) };
}

module.exports = { parseMaxOutputTokens, applyMaxOutputTokens, MIN, MAX };
