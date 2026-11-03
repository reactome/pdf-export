// Analysis tokens (spec 001 T020 and T021, research R6). The service reads a token
// URL-decoded until it no longer changes, so a token encoded once or many times names the
// same result; what is sent is that token in one canonical form, its value's padded Base64
// with its `=` as `%3D`, never the input as given. Only the form the service issues is sent: anything
// else is `unknown-token` before any request, as the service's answers to one (its
// catch-all 500, the servlet container's HTML 400, another route) would read as
// `unavailable` or worse.
import { AnalysisError } from './error.ts';

/**
 * The longest token read, as given. Each `%25` layer is decoded over the whole token, so the
 * time grows with the square of its length: a token of this length is read within tens of
 * milliseconds (a 32 KiB one took a third of a second, a 200 KiB one half a minute), and one
 * the service issues, 48 characters at most, can still be nested in a thousand layers.
 */
export const MAX_TOKEN_LENGTH = 8 * 1024;
/** Base64's letters and digits, and at most two `=` of padding. */
const BASE64 = /^([A-Za-z0-9]+)(={0,2})$/;
/** What the service encodes: `{yyyyMMddHHmmss}_{counter}`, the counter a Java `long`. */
const DECODED = /^[0-9]{14}_[0-9]{1,19}$/;

/**
 * The token to send, checked against the form the service issues: no longer than
 * `MAX_TOKEN_LENGTH` as given, URL-decoded until it no longer changes, non-empty Base64 letters and digits with at most two `=`, its length then a
 * multiple of 4 and not 1 modulo 4 without them, decoding to `{14 digits}_{1 to 19 digits}`.
 * Anything else is `unknown-token`. Its date is not judged: that is the service's to say.
 */
export function canonicalToken(token: string): string {
  const malformed = () =>
    new AnalysisError('unknown-token', 'The analysis token is not one the service issues');
  if (token.length > MAX_TOKEN_LENGTH) throw malformed();
  const decoded = urlDecoded(token);
  const match = BASE64.exec(decoded);
  if (!match) throw malformed();
  const [, bare = '', padding = ''] = match;
  // padding only where it makes the length whole; never a lone character in the last four
  if (padding !== '' && decoded.length % 4 !== 0) throw malformed();
  if (bare.length % 4 === 1) throw malformed();
  // Node's decoder skips what is not Base64 and drops a lone last character, which Java's
  // refuses: the letters and the length are checked above
  const value = Buffer.from(bare, 'base64').toString('latin1');
  if (!DECODED.test(value)) throw malformed();
  // encoded again from the value, as the service issued it: Base64 whose last character
  // differs only in bits no byte holds (`…Mx` and `…Mw`) decodes alike and is sent alike
  return Buffer.from(value, 'latin1').toString('base64').replaceAll('=', '%3D');
}

/** The token URL-decoded until it no longer changes; one that cannot be is malformed. */
function urlDecoded(token: string): string {
  let decoded = token;
  for (;;) {
    let next: string;
    try {
      // as Java's URLDecoder, which reads `+` as a space
      next = decodeURIComponent(decoded.replaceAll('+', ' '));
    } catch {
      throw new AnalysisError('unknown-token', 'The analysis token cannot be URL-decoded');
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
}
