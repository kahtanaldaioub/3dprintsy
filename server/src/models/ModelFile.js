import mongoose from "mongoose";

const modelFileSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    originalName: { type: String, required: true, maxlength: 180 },
    format: { type: String, enum: ["stl", "obj"], required: true },
    size: { type: Number, required: true },
    storageName: { type: String, required: true, unique: true },
    analysis: { type: mongoose.Schema.Types.Mixed, default: null },
    analyzedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

export const ModelFile = mongoose.model("ModelFile", modelFileSchema);
