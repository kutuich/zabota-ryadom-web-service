import { env } from "./config/env";
import { createApp } from "./app";

const app = createApp();

app.listen(env.port, "0.0.0.0", () => {
  console.log(`Zabota Ryadom API listening on http://0.0.0.0:${env.port}`);
});
