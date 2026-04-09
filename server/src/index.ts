import dotenv from "dotenv";
import path from "path";

// Load .env from monorepo root (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { createApp } from "./app";
import { InMemoryStorage } from "./services/storage";
import { config } from "./config/env";

const isProduction = config.nodeEnv === "production";

const app = isProduction
  ? createApp({ mode: "drive" })
  : createApp({ mode: "memory", storage: new InMemoryStorage() });

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Storage: ${isProduction ? "Google Drive" : "In-Memory"}`);
});
