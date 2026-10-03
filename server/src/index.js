import dotenv from "dotenv";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import mongoose from "mongoose";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { modelRouter } from "./routes/models.js";
import { orderRouter } from "./routes/orders.js";
import { parseOctoPrintPrinters } from "./services/octoprint.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(currentDir, "..", ".env") });

const app = express();
const port = Number(process.env.PORT ?? 4000);
const clientOrigin = process.env.CLIENT_ORIGIN ?? "http://localhost:5173";
const jwtSecret = process.env.JWT_SECRET ?? "";
const mongoUri = process.env.MONGO_URI ?? "";
const printers = parseOctoPrintPrinters(process.env.OCTOPRINT_PRINTERS);
const uploadDirectory = path.resolve(
  currentDir,
  "..",
  process.env.UPLOAD_DIR ?? "uploads"
);

if (jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters.");
}
if (!mongoUri) {
  throw new Error("MONGO_URI must be configured before starting the API.");
}

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: clientOrigin }));
app.use(express.json({ limit: "32kb" }));

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok", database: mongoose.connection.readyState === 1 });
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter(printers));
app.use("/api/models", modelRouter(uploadDirectory));
app.use("/api/orders", orderRouter);

app.use((error, _request, response, _next) => {
  if (error.name === "MulterError") {
    const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    response.status(status).json({ message: error.message });
    return;
  }
  if (error.status && error.status < 500) {
    response.status(error.status).json({ message: error.message });
    return;
  }
  console.error(error);
  response.status(500).json({ message: "An unexpected server error occurred." });
});

await mkdir(uploadDirectory, { recursive: true });
try {
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 });
} catch (error) {
  const networkCode = error.cause?.code;
  console.error(
    "Could not connect to MongoDB. Check MONGO_URI, the database user's credentials, and network access."
  );
  console.error(
    "For MongoDB Atlas, add this machine's current public IP under Security > Network Access. Avoid allowing all IPs."
  );
  console.error(
    `Connection error: ${error.name}${error.reason?.type ? ` (${error.reason.type})` : ""}${networkCode ? ` [${networkCode}]` : ""}`
  );
  process.exit(1);
}
app.listen(port, () => {
  console.log(`KD Prints API listening on http://localhost:${port}`);
});
