import mongoose from "mongoose";

const QuestionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: [true, "Please provide the question text."],
    trim: true,
  },
  options: {
    type: [String],
    required: [true, "Please provide options."],
    validate: [
      (val) => val.length >= 2,
      "A question must have at least 2 options.",
    ],
  },
  correctAnswer: {
    type: Number,
    required: [true, "Please provide the correct option index (0-indexed)."],
    min: 0,
  },
  explanation: {
    type: String,
    trim: true,
  },
  subject: {
    type: String,
    required: [true, "Please provide the medical subject."],
    trim: true,
    default: "General Medicine",
  },
  chapter: {
    type: String,
    trim: true,
  },
  difficulty: {
    type: String,
    enum: ["Easy", "Medium", "Hard"],
    default: "Medium",
  },
  image: {
    type: String, // Cloudinary image URL
    default: null,
  },
  tags: {
    type: [String],
    default: [],
  },
  stats: {
    answeredCorrectly: { type: Number, default: 0 },
    answeredWrongly: { type: Number, default: 0 },
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

QuestionSchema.index({ subject: 1 });
QuestionSchema.index({ difficulty: 1 });
QuestionSchema.index({ question: "text" });

export default mongoose.models.Question || mongoose.model("Question", QuestionSchema);
