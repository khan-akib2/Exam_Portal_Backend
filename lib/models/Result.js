import mongoose from "mongoose";

const ResultSchema = new mongoose.Schema({
  exam: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  attempt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Attempt",
    required: true,
  },
  score: {
    type: Number,
    required: true,
  },
  totalQuestions: {
    type: Number,
    required: true,
  },
  correctAnswers: {
    type: Number,
    required: true,
  },
  wrongAnswers: {
    type: Number,
    required: true,
  },
  skippedAnswers: {
    type: Number,
    required: true,
  },
  accuracy: {
    type: Number, // Percentage of correct answers relative to attempted
    required: true,
  },
  timeTaken: {
    type: Number, // In seconds
    required: true,
  },
  xpEarned: {
    type: Number,
    default: 0,
  },
  passed: {
    type: Boolean,
    required: true,
  },
  answersSnapshot: [
    {
      question: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
        required: true,
      },
      selectedOption: {
        type: Number,
        default: null,
      },
      correctOption: {
        type: Number,
        required: true,
      },
      isCorrect: {
        type: Boolean,
        default: false,
      },
    },
  ],
  submittedAt: {
    type: Date,
    default: Date.now,
  },
});

ResultSchema.index({ user: 1 });
ResultSchema.index({ exam: 1 });

export default mongoose.models.Result || mongoose.model("Result", ResultSchema);
