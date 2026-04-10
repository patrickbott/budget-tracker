/** Base class for all SimpleFIN Bridge errors. */
export class BridgeError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BridgeError';
    this.code = code;
  }
}

/** The Setup Token could not be base64-decoded, or POSTing to the decoded URL returned non-2xx. */
export class SetupTokenInvalidError extends BridgeError {
  constructor(message: string, options?: ErrorOptions) {
    super('setup_token_invalid', message, options);
    this.name = 'SetupTokenInvalidError';
  }
}

/** The Access URL is malformed (missing userinfo, wrong scheme, etc.). */
export class AccessUrlError extends BridgeError {
  constructor(message: string, options?: ErrorOptions) {
    super('access_url_invalid', message, options);
    this.name = 'AccessUrlError';
  }
}

/** A `fetch` call threw, or the Bridge response was not parseable JSON. */
export class NetworkError extends BridgeError {
  constructor(message: string, options?: ErrorOptions) {
    super('network_error', message, options);
    this.name = 'NetworkError';
  }
}

/** The Bridge response JSON did not match the expected Zod schema. */
export class ProtocolError extends BridgeError {
  constructor(message: string, options?: ErrorOptions) {
    super('protocol_error', message, options);
    this.name = 'ProtocolError';
  }
}

/** The Bridge returned HTTP 429, or `errlist` contains a rate-limit code. */
export class RateLimitError extends BridgeError {
  constructor(message: string, options?: ErrorOptions) {
    super('rate_limit', message, options);
    this.name = 'RateLimitError';
  }
}

/** The Bridge returned HTTP 401 or 403 — the Access URL credential is rejected. */
export class AuthError extends BridgeError {
  constructor(message: string, options?: ErrorOptions) {
    super('auth_error', message, options);
    this.name = 'AuthError';
  }
}
