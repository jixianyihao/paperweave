import type { FastifyReply } from "fastify";

// 劫持 Fastify 响应，写 SSE 流；返回帧发送函数
export function startSse(reply: FastifyReply): { send: (obj: unknown) => void; end: () => void } {
  reply.hijack();
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  return {
    send: (obj) => { reply.raw.write(`data: ${JSON.stringify(obj)}\n\n`); },
    end: () => { reply.raw.end(); },
  };
}
