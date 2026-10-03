import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { authenticate } from "../middleware/authenticate.js";
import { ModelFile } from "../models/ModelFile.js";
import mongoose from "mongoose";

const maxFileSize = 25 * 1024 * 1024;
const acceptedFormats = new Set(["stl", "obj"]);

function fileFormat(originalName) {
  const extension = path.extname(originalName).slice(1).toLowerCase();
  return acceptedFormats.has(extension) ? extension : null;
}

function validateGeometry(buffer, format) {
  if (format === "obj") {
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch {
      return false;
    }
    return /^\s*v\s+[-+\d.]/m.test(text) && /^\s*f\s+[\d/+-]+/m.test(text);
  }

  if (buffer.length >= 84) {
    const triangleCount = buffer.readUInt32LE(80);
    if (84 + triangleCount * 50 === buffer.length && triangleCount > 0) return true;
  }
  const text = buffer.toString("utf8");
  return /^\s*solid\b/i.test(text) && /\bfacet\s+normal\b/i.test(text) && /\bvertex\s+/i.test(text);
}

export function modelRouter(uploadDirectory) {
  const router = Router();
  const analysisServiceUrl = (
    process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000"
  ).replace(/\/+$/, "");
  const storage = multer.diskStorage({
    destination: uploadDirectory,
    filename: (_request, _file, callback) => callback(null, `${randomUUID()}.upload`)
  });
  const upload = multer({
    storage,
    limits: { fileSize: maxFileSize, files: 1 },
    fileFilter: (_request, file, callback) => {
      if (!fileFormat(file.originalname)) {
        callback(Object.assign(new Error("Upload an STL or OBJ model."), { status: 400 }));
        return;
      }
      callback(null, true);
    }
  });

  router.use(authenticate);

  router.get("/", async (request, response) => {
    const models = await ModelFile.find({ owner: request.userId })
      .sort({ createdAt: -1 })
      .select("-storageName");
    response.json({ models });
  });

  router.post("/", upload.single("model"), async (request, response) => {
    if (!request.file) {
      response.status(400).json({ message: "Choose an STL or OBJ file to upload." });
      return;
    }

    const format = fileFormat(request.file.originalname);
    const valid = validateGeometry(await readFile(request.file.path), format);
    if (!valid) {
      await unlink(request.file.path);
      response.status(400).json({ message: "This file does not contain a valid STL or OBJ mesh." });
      return;
    }

    try {
      const model = await ModelFile.create({
        owner: request.userId,
        originalName: path.basename(request.file.originalname).slice(0, 180),
        format,
        size: request.file.size,
        storageName: request.file.filename
      });
      response.status(201).json({
        model: {
          id: model.id,
          originalName: model.originalName,
          format: model.format,
          size: model.size,
          createdAt: model.createdAt
        }
      });
    } catch (error) {
      await unlink(request.file.path);
      throw error;
    }
  });

  router.post("/:id/analyze", async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      response.status(404).json({ message: "Model not found." });
      return;
    }

    const model = await ModelFile.findOne({
      _id: request.params.id,
      owner: request.userId
    });
    if (!model) {
      response.status(404).json({ message: "Model not found." });
      return;
    }

    const modelPath = path.join(uploadDirectory, model.storageName);
    const contents = await readFile(modelPath);
    const form = new FormData();
    form.append(
      "model",
      new Blob([contents], {
        type: model.format === "obj" ? "text/plain" : "model/stl"
      }),
      model.originalName
    );

    let serviceResponse;
    try {
      serviceResponse = await fetch(`${analysisServiceUrl}/analyze`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(60_000)
      });
    } catch (error) {
      const timedOut = error.name === "TimeoutError";
      console.error(
        `Printability service request ${timedOut ? "timed out" : "failed"} for model ${model.id}.`
      );
      response
        .status(timedOut ? 504 : 503)
        .json({
          message: timedOut
            ? "Printability analysis took too long. Please try again."
            : "Printability analysis is unavailable. Make sure the Python service is running."
        });
      return;
    }

    const result = await serviceResponse.json().catch(() => null);
    if (!serviceResponse.ok) {
      const detail =
        typeof result?.detail === "string"
          ? result.detail
          : "Printability analysis could not process this model.";
      response
        .status(serviceResponse.status < 500 ? 422 : 502)
        .json({ message: detail });
      return;
    }

    model.analysis = result;
    model.analyzedAt = new Date();
    await model.save();

    response.json({
      analysis: result,
      analyzedAt: model.analyzedAt
    });
  });

  router.get("/:id/file", async (request, response) => {
    if (!mongoose.isValidObjectId(request.params.id)) {
      response.status(404).json({ message: "Model not found." });
      return;
    }
    const model = await ModelFile.findOne({ _id: request.params.id, owner: request.userId });
    if (!model) {
      response.status(404).json({ message: "Model not found." });
      return;
    }
    response.type(model.format === "obj" ? "text/plain" : "model/stl");
    response.set("Content-Disposition", `inline; filename="${encodeURIComponent(model.originalName)}"`);
    response.send(await readFile(path.join(uploadDirectory, model.storageName)));
  });

  return router;
}
