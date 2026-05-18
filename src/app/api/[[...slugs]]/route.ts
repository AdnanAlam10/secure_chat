import { redis } from "@/lib/redis";
import { Elysia } from "elysia";
import { nanoid } from "nanoid";
import { authMiddleware } from "./auth";
import z from "zod";
import { Message, realtime } from "@/lib/realtime";
import {
  createRoomLimiter,
  getClientIp,
  messageLimiter,
} from "@/lib/ratelimit";

const ROOM_TTL_SECONDS = 60 * 10;

const rooms = new Elysia({ prefix: "/room" })
  .post("/create", async ({ request, set }) => {
    const ip = getClientIp(request.headers);
    const { success } = await createRoomLimiter.limit(ip);
    if (!success) {
      set.status = 429;
      return { error: "Too many rooms created. Slow down." };
    }

    const roomId = nanoid();
    const expiresAt = Date.now() + ROOM_TTL_SECONDS * 1000;

    await redis.hset(`meta:${roomId}`, {
      connected: [],
      createdAt: Date.now(),
      expiresAt,
    });
    await redis.expire(`meta:${roomId}`, ROOM_TTL_SECONDS);

    return { roomId };
  })
  .use(authMiddleware)
  .get(
    "/ttl",
    async ({ auth }) => {
      const expiresAt = await redis.hget<number>(
        `meta:${auth.roomId}`,
        "expiresAt",
      );
      return { expiresAt: expiresAt ?? 0 };
    },
    { query: z.object({ roomId: z.string() }) },
  )
  .delete(
    "/",
    async ({ auth }) => {
      await realtime
        .channel(auth.roomId)
        .emit("chat.destroy", { isDestroyed: true });

      await Promise.all([
        redis.del(`meta:${auth.roomId}`),
        redis.del(`messages:${auth.roomId}`),
      ]);
    },
    { query: z.object({ roomId: z.string() }) },
  );

const messages = new Elysia({ prefix: "/messages" })
  .use(authMiddleware)
  .post(
    "/",
    async ({ body, auth, request, set }) => {
      const ip = getClientIp(request.headers);
      const { success } = await messageLimiter.limit(
        `${ip}:${auth.roomId}`,
      );
      if (!success) {
        set.status = 429;
        return { error: "Too many messages. Slow down." };
      }

      const { sender, ciphertext, iv } = body;
      const { roomId } = auth;

      const roomExists = await redis.exists(`meta:${roomId}`);

      if (!roomExists) {
        throw new Error("Room does not exist");
      }

      const message: Message = {
        id: nanoid(),
        sender,
        ciphertext,
        iv,
        timestamp: Date.now(),
        roomId,
      };

      await redis.rpush(`messages:${roomId}`, message);
      await realtime.channel(roomId).emit("chat.message", message);

      const remaining = await redis.ttl(`meta:${roomId}`);
      if (remaining > 0) {
        await redis.expire(`messages:${roomId}`, remaining);
      }
    },
    {
      query: z.object({ roomId: z.string() }),
      body: z.object({
        sender: z.string().max(100),
        ciphertext: z.string().max(4000),
        iv: z.string().max(64),
      }),
    },
  )
  .get(
    "/",
    async ({ auth }) => {
      const messages = await redis.lrange<Message>(
        `messages:${auth.roomId}`,
        0,
        -1,
      );
      return { messages };
    },
    {
      query: z.object({ roomId: z.string() }),
    },
  );

const app = new Elysia({ prefix: "/api" }).use(rooms).use(messages);

export const GET = app.fetch;
export const POST = app.fetch;
export const DELETE = app.fetch;

export type App = typeof app;
