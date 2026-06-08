import mongoose from "mongoose";

const ExamSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, "Please provide the exam name."],
    trim: true,
  },
  description: {
    type: String,
    trim: true,
  },
  duration: {
    type: Number,
    required: [true, "Please provide the exam duration in minutes."],
    min: 1,
  },
  totalQuestions: {
    type: Number,
    default: 0,
  },
  passingMarks: {
    type: Number,
    required: [true, "Please provide the passing marks."],
    default: 50,
  },
  negativeMarking: {
    type: Number,
    default: 0, // e.g., -0.25 for 1/4th negative marking
  },
  examType: {
    type: String,
    enum: ["Mock Test", "Practice", "Daily Challenge", "Semester Exam"],
    default: "Practice",
  },
  questions: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Question",
    },
  ],
  status: {
    type: String,
    enum: ["draft", "published", "archived"],
    default: "draft",
  },
  assignedBatches: {
    type: [String],
    default: ["General"], // Batches allowed to see this exam
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  scheduledFor: {
    type: Date,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.Exam || mongoose.model("Exam", ExamSchema);
