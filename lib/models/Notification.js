import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  content: {
    type: String,
    required: true,
    trim: true,
  },
  type: {
    type: String,
    enum: ["exam_alert", "maintenance", "general"],
    default: "general",
  },
  targetBatch: {
    type: String,
    default: "All", // "All" or a specific batch name like "2026-A"
  },
  sentBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Notification || mongoose.model("Notification", NotificationSchema);
