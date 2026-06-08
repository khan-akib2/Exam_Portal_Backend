import mongoose from "mongoose";

const ActivityLogSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  userEmail: {
    type: String,
    trim: true,
  },
  action: {
    type: String,
    required: true, // e.g., 'LOGIN', 'LOGOUT', 'SUBADMIN_CREATED', 'EXAM_CREATED', 'TAB_SWITCH', 'PERMISSION_CHANGED'
  },
  details: {
    type: String,
    trim: true,
  },
  ipAddress: {
    type: String,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.ActivityLog || mongoose.model("ActivityLog", ActivityLogSchema);
