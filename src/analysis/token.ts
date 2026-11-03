// Analysis tokens (spec 001 T020; T021 adds the form check, research R6). The service
// reads a token URL-decoded until it no longer changes, so a token encoded once or many
// times names the same result; what is sent is that token in one canonical form, padded
// Base64 with its `=` as `%3D`, never the input as given.
import { AnalysisError } from './error.ts';

/**
 * The token to send. It is not checked here: a token the service would not issue is T021's
 * to refuse before this is called. One that cannot even be URL-decoded is unknown.
 */
export function canonicalToken(token: string): string {
  let decoded = token;
  for (;;) {
    let next: string;
    try {
      // as Java's URLDecoder, which reads `+` as a space
      next = decodeURIComponent(decoded.replaceAll('+', ' '));
    } catch {
      throw new AnalysisError('unknown-token', 'The analysis token cannot be URL-decoded');
    }
    if (next === decoded) break;
    decoded = next;
  }
  const bare = decoded.replace(/=+$/, '');
  const padded = bare.padEnd(Math.ceil(bare.length / 4) * 4, '=');
  return encodeURIComponent(padded);
}
