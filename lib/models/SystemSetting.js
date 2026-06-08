import mongoose from "mongoose";

const SystemSettingSchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    default: "global_config",
  },
  maintenanceMode: {
    type: Boolean,
    default: false,
  },
  antiCheatEnabled: {
    type: Boolean,
    default: true,
  },
  xpPerCorrectAnswer: {
    type: Number,
    default: 10,
  },
  xpPerWrongAnswer: {
    type: Number,
    default: 0,
  },
  streakBonusXp: {
    type: Number,
    default: 20, // Extra XP for maintaining streak
  },
  updatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.SystemSetting || mongoose.model("SystemSetting", SystemSettingSchema);
