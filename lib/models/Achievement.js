import mongoose from "mongoose";

const AchievementSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true, // e.g. "streak_5", "first_exam", "top_performer"
  },
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  icon: {
    type: String, // lucide icon name e.g. 'Zap', 'Award', 'Trophy', 'Activity'
    default: "Award",
  },
  xpBonus: {
    type: Number,
    default: 50,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Achievement || mongoose.model("Achievement", AchievementSchema);
