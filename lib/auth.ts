import { timingSafeEqual } from "node:crypto";

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function isAuthorized(request: Request): boolean {
  const expected = process.env.MCP_ACCESS_KEY;

  if (!expected || expected.length < 24) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  const queryKey = new URL(request.url).searchParams.get("key");
  const supplied = bearer ?? queryKey;

  return Boolean(supplied && secureEqual(supplied, expected));
}
