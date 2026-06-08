import mongoose from "mongoose";

const DraftQuestionSchema = new mongoose.Schema({
  question: {
    type: String,
    required: false,
    trim: true,
  },
  options: {
    type: [String],
    default: [],
  },
  correctAnswer: {
    type: Number,
    default: 0,
  },
  explanation: {
    type: String,
    trim: true,
    default: "",
  },
  subject: {
    type: String,
    trim: true,
    default: "General Medicine",
  },
  chapter: {
    type: String,
    trim: true,
    default: "",
  },
  difficulty: {
    type: String,
    enum: ["Easy", "Medium", "Hard"],
    default: "Medium",
  },
  image: {
    type: String, // Cloudinary image URL or base64 or local path
    default: null,
  },
  confidenceScore: {
    type: Number,
    default: 100,
  },
  matchStrategy: {
    type: String,
    default: "none",
  },
  optionMetadata: {
    type: [{
      isBold: { type: Boolean, default: false },
      isHighlighted: { type: Boolean, default: false },
      isUnderlined: { type: Boolean, default: false },
      isColored: { type: Boolean, default: false },
    }],
    default: [],
  },
  status: {
    type: String,
    enum: ["Needs Review", "Auto Approved", "Published"],
    default: "Needs Review",
  },
  tags: {
    type: [String],
    default: [],
  },
  pdfName: {
    type: String,
    required: true,
  },
  pageNum: {
    type: Number,
    default: 1,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

DraftQuestionSchema.index({ pdfName: 1, status: 1 });
DraftQuestionSchema.index({ status: 1 });

export default mongoose.models.DraftQuestion || mongoose.model("DraftQuestion", DraftQuestionSchema);
