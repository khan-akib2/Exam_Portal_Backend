import mongoose from "mongoose";

const AttemptSchema = new mongoose.Schema({
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
  startedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    enum: ["active", "submitted"],
    default: "active",
  },
  answers: [
    {
      question: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Question",
        required: true,
      },
      selectedOption: {
        type: Number, // Index of selected option (0, 1, 2, 3) or null if unanswered
        default: null,
      },
      isMarkedForReview: {
        type: Boolean,
        default: false,
      },
      visited: {
        type: Boolean,
        default: false,
      },
    },
  ],
  warnings: {
    type: Number,
    default: 0,
  },
  warningLogs: [
    {
      type: {
        type: String,
        enum: ["tab_switch", "fullscreen_exit", "copy_attempt", "right_click"],
      },
      timestamp: {
        type: Date,
        default: Date.now,
      },
      details: String,
    },
  ],
  submittedAt: {
    type: Date,
  },
});

AttemptSchema.index({ user: 1, exam: 1, status: 1 });

export default mongoose.models.Attempt || mongoose.model("Attempt", AttemptSchema);
