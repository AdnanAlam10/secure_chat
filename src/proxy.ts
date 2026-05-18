import { NextRequest, NextResponse } from "next/server";
import { redis } from "./lib/redis";
import { nanoid } from "nanoid";

const JOIN_SCRIPT = `
local exists = redis.call('EXISTS', KEYS[1])
if exists == 0 then return -1 end
local v = redis.call('HGET', KEYS[1], 'connected')
if not v then v = '[]' end
local arr = cjson.decode(v)
if #arr >= 2 then return -2 end
table.insert(arr, ARGV[1])
redis.call('HSET', KEYS[1], 'connected', cjson.encode(arr))
return 1
`;

export const proxy = async (req: NextRequest) => {
  const pathname = req.nextUrl.pathname;

  const roomMatch = pathname.match(/^\/room\/([^/]+)$/);

  if (!roomMatch) return NextResponse.redirect(new URL("/", req.url));

  const roomId = roomMatch[1];
  const existingToken = req.cookies.get("x-auth-token")?.value;

  if (existingToken) {
    const connected = await redis.hget<string[]>(
      `meta:${roomId}`,
      "connected",
    );
    if (connected === null) {
      return NextResponse.redirect(new URL("/?error=room-not-found", req.url));
    }
    if (connected.includes(existingToken)) {
      return NextResponse.next();
    }
  }

  const token = nanoid();
  const result = (await redis.eval(
    JOIN_SCRIPT,
    [`meta:${roomId}`],
    [token],
  )) as number;

  if (result === -1) {
    return NextResponse.redirect(new URL("/?error=room-not-found", req.url));
  }
  if (result === -2) {
    return NextResponse.redirect(new URL("/?error=room-full", req.url));
  }

  const response = NextResponse.next();
  response.cookies.set("x-auth-token", token, {
    path: "/",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
  });

  return response;
};

export const config = {
  matcher: "/room/:path*",
};
