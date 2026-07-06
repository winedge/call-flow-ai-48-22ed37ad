export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Api-Key, X-Webhook-Signature",
  "Access-Control-Max-Age": "86400",
} as const;

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(init.headers ?? {}),
    },
  });
}

export function preflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function errorJson(status: number, message: string, extra?: unknown) {
  return json({ error: { status, message, details: extra } }, { status });
}

/**
 * Simple API-key gate. When BULKCALL_API_KEY is unset (preview/dev) all
 * requests are allowed so the docs page can be exercised. In production
 * set the secret and every call must send `X-Api-Key: <key>`.
 */
export function requireApiKey(request: Request): Response | null {
  const expected = process.env.BULKCALL_API_KEY;
  if (!expected) return null;
  const provided =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided && provided === expected) return null;
  return errorJson(401, "Invalid or missing API key");
}
