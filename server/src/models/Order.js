import mongoose from "mongoose";

const orderSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    model: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ModelFile",
      required: true
    },
    material: {
      type: String,
      enum: ["PLA", "PETG", "ABS", "TPU", "Resin"],
      required: true
    },
    color: { type: String, trim: true, maxlength: 40, default: "Natural" },
    quantity: { type: Number, min: 1, max: 100, required: true },
    postProcessing: { type: Boolean, default: false },
    notes: { type: String, trim: true, maxlength: 1000, default: "" },
    status: {
      type: String,
      enum: ["pending", "in_review", "printing", "ready", "completed", "cancelled"],
      default: "pending"
    }
  },
  { timestamps: true }
);

export const Order = mongoose.model("Order", orderSchema);
