// Vercel serverless entry point: exposes the same Express app as the local server.
import { createApp } from "../src/app.js";

const app = createApp();
export default app;
