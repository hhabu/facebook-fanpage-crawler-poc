import { getConfig } from "./config/env";
import { app } from "./app";

const config = getConfig();

app.listen(config.port, () => {
  console.log(`Multi-bot crawler API running at http://localhost:${config.port}`);
});
