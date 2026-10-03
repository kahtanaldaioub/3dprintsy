import { Router } from "express";
import mongoose from "mongoose";
import { authenticate } from "../middleware/authenticate.js";
import { ModelFile } from "../models/ModelFile.js";
import { Order } from "../models/Order.js";

export const orderRouter = Router();
const materials = new Set(["PLA", "PETG", "ABS", "TPU", "Resin"]);

orderRouter.use(authenticate);

orderRouter.get("/", async (request, response) => {
  const orders = await Order.find({ owner: request.userId })
    .populate("model", "originalName format")
    .sort({ createdAt: -1 });
  response.json({ orders });
});

orderRouter.post("/", async (request, response) => {
  const { modelId, material, color, quantity, postProcessing, notes } = request.body;
  const parsedQuantity = Number(quantity);
  if (
    typeof modelId !== "string" ||
    !mongoose.isValidObjectId(modelId) ||
    !materials.has(material) ||
    !Number.isInteger(parsedQuantity) ||
    parsedQuantity < 1 ||
    parsedQuantity > 100 ||
    (color !== undefined && (typeof color !== "string" || color.trim().length > 40)) ||
    (notes !== undefined && (typeof notes !== "string" || notes.length > 1000)) ||
    (postProcessing !== undefined && typeof postProcessing !== "boolean")
  ) {
    response.status(400).json({ message: "Review the order details and try again." });
    return;
  }

  const model = await ModelFile.findOne({ _id: modelId, owner: request.userId });
  if (!model) {
    response.status(404).json({ message: "Upload a model before placing an order." });
    return;
  }

  const order = await Order.create({
    owner: request.userId,
    model: model.id,
    material,
    color: color?.trim() || "Natural",
    quantity: parsedQuantity,
    postProcessing: postProcessing ?? false,
    notes: notes?.trim() ?? ""
  });
  await order.populate("model", "originalName format");
  response.status(201).json({ order });
});

orderRouter.patch("/:id/cancel", async (request, response) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    response.status(404).json({ message: "Order not found." });
    return;
  }
  const order = await Order.findOneAndUpdate(
    { _id: request.params.id, owner: request.userId, status: "pending" },
    { status: "cancelled" },
    { new: true }
  ).populate("model", "originalName format");

  if (!order) {
    response.status(409).json({ message: "Only pending orders can be cancelled." });
    return;
  }
  response.json({ order });
});
