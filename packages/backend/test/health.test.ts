import { describe, it, expect } from "vitest";
import { buildServer } from "../src/server.js";

describe("GET /api/health", () => {
  it("returns ok", async () => {
    const app = buildServer();
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", version: "0.1.0" });
    await app.close();
  });
});
