import dotenv from "dotenv";
import path from "path";

// Load .env from monorepo root (one level up from server/)
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

import { createApp } from "./app";
import { InMemoryStorage } from "./services/storage";
import { config } from "./config/env";

// In production, this would use DriveStorage with real Google Auth.
// For development, we use in-memory storage.
const storage = new InMemoryStorage();
const app = createApp(storage);

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
  console.log(`Environment: ${config.nodeEnv}`);
});
