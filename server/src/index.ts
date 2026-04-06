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
