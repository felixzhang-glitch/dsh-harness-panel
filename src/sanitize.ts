/**
 * Display sanitization for the panel's host output. Everything the panel
 * shows — server targets, error text, probe details — passes through these
 * pure functions so URL credentials, header values, and bearer tokens never
 * reach the browser. Configured `env`/`headers` VALUES never leave the host
 * at all (only their keys are surfaced).
 *
 * @module dsh-harness-panel/sanitize
 */

/** Replacement for every redacted credential value. */
export const REDACTED = '***'

/** Query/field keys whose values are credentials regardless of name casing. */
const CREDENTIAL_KEY = /^(?:access[_-]?token|api[_-]?key|apikey|auth|authorization|client[_-]?secret|key|password|passwd|pwd|secret|sig|signature|token)$/iu

/** Credential key fragment for the pattern fallbacks. */
const KEY_SRC = '(?:access[_-]?token|api[_-]?key|apikey|auth(?:orization)?|client[_-]?secret|key|passw(?:or)?d|passwd|pwd|secret|sig(?:nature)?|token)'

/** Whole userinfo before `@` (unparseable URLs only). */
const USERINFO = /([a-z][a-z0-9+.-]*:\/\/)([^/@\s]+)@/giu

/** `?key=value` / `&key=value` credential pairs inside arbitrary text. */
const QUERY_CREDENTIAL = new RegExp(`([?&](?:[^=&#\\s]*${KEY_SRC}[^=&#\\s]*)=)[^&#\\s]*`, 'giu')

/** `#key=value` credential pairs in fragments and arbitrary text. */
const FRAGMENT_CREDENTIAL = new RegExp(`(#[^=&#\\s]*${KEY_SRC}[^=&#\\s]*=)[^&#\\s]*`, 'giu')

/** `Authorization: <value>`-style header lines (quoted value). */
const HEADER_QUOTED = new RegExp(`(\\b${KEY_SRC}\\s*[:=]\\s*["'])[^"']*(["'])`, 'giu')

/** `Authorization: <value>`-style header lines (bare value). */
const HEADER_BARE = new RegExp(`(\\b${KEY_SRC}\\s*[:=]\\s*)[^\\s,;)\\]}]+`, 'giu')

/** Environment-variable-shaped credentials (`GITHUB_TOKEN=…`). */
const ENV_VAR = /\b[A-Za-z0-9_]*(?:TOKEN|API[_-]?KEY|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*\s*=\s*[^\s,;)\]}]+/gu

/** Bearer tokens, keyword included. */
const BEARER = /(bearer)\s+[A-Za-z0-9._~+/=-]+/giu

/** Quoted JSON-ish `"token": "value"` pairs. */
const QUOTED_PAIR = new RegExp(`(["'](?:access[_-]?token|api[_-]?key|client[_-]?secret|secret|token)["']\\s*[:=]\\s*["'])[^"']*(["'])`, 'giu')

/** Raw JWT bodies. */
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/gu

/**
 * Redact a URL for display: userinfo password, credential query values, and
 * credential fragment pairs. Unparseable input falls back to pattern
 * redaction instead of throwing.
 */
export function sanitizeUrl(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
      .replace(USERINFO, '$1***@')
      .replace(QUERY_CREDENTIAL, `$1${REDACTED}`)
      .replace(FRAGMENT_CREDENTIAL, `$1${REDACTED}`)
  }
  if (parsed.password !== '') parsed.password = REDACTED
  for (const key of [...parsed.searchParams.keys()]) {
    if (CREDENTIAL_KEY.test(key)) parsed.searchParams.set(key, REDACTED)
  }
  if (parsed.hash !== '') parsed.hash = parsed.hash.replace(FRAGMENT_CREDENTIAL, `$1${REDACTED}`)
  return parsed.toString()
}

/** Redact credential-shaped fragments from free text. */
export function sanitizeText(text: string): string {
  return text
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(HEADER_QUOTED, `$1${REDACTED}$2`)
    .replace(HEADER_BARE, `$1${REDACTED}`)
    .replace(ENV_VAR, value => {
      const equals = value.indexOf('=')
      return equals < 0 ? value : `${value.slice(0, equals)}=${REDACTED}`
    })
    .replace(QUOTED_PAIR, `$1${REDACTED}$2`)
    .replace(QUERY_CREDENTIAL, `$1${REDACTED}`)
    .replace(FRAGMENT_CREDENTIAL, `$1${REDACTED}`)
    .replace(JWT, REDACTED)
}

/** Stringify an arbitrary thrown value safely and redact it for display. Never throws. */
export function sanitizeError(error: unknown): string {
  let text: string
  try {
    text = typeof error === 'string' ? error : String(error)
  } catch {
    text = '<unrenderable error>'
  }
  return sanitizeText(text)
}

/** Bound one display string so hostile input cannot blow up layouts. */
export function bounded(value: string, limit = 160): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}
