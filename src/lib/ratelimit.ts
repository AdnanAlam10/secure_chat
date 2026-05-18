import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis";

export const messageLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "10 s"),
  prefix: "rl:msg",
  analytics: false,
});

export const createRoomLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "60 s"),
  prefix: "rl:create",
  analytics: false,
});

export function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "anon"
  );
}
