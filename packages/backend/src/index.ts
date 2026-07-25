import { buildServer } from "./server.js";

const port = Number(process.env.PORT ?? 8471);
const app = buildServer();

app.listen({ port, host: "127.0.0.1" }).then(() => {
  console.log(`backend listening on http://127.0.0.1:${port}`);
});
