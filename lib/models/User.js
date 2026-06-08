import mongoose from "mongoose";

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please provide a name."],
    trim: true,
  },
  email: {
    type: String,
    required: [true, "Please provide an email."],
    unique: true,
    lowercase: true,
    trim: true,
  },
  phone: {
    type: String,
    trim: true,
  },
  password: {
    type: String,
    required: [true, "Please provide a password."],
  },
  role: {
    type: String,
    enum: ["super_admin", "admin", "student"],
    default: "student",
    index: true,
  },
  permissions: {
    type: [String],
    default: [], // e.g., ['manage_users', 'manage_questions', 'manage_exams', 'view_analytics']
  },
  status: {
    type: String,
    enum: ["active", "suspended"],
    default: "active",
  },
  batch: {
    type: String,
    trim: true,
    default: "General",
    index: true,
  },
  // Gamification fields for students
  xp: {
    type: Number,
    default: 0,
  },
  streak: {
    type: Number,
    default: 0,
  },
  lastActive: {
    type: Date,
  },
  level: {
    type: String,
    enum: ["Intern", "Resident", "Senior Resident", "Consultant", "Master"],
    default: "Intern",
  },
  achievements: {
    type: [String], // Array of unlocked achievement keys or IDs
    default: [],
  },
  needsPasswordReset: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.User || mongoose.model("User", UserSchema);
