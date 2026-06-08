import mongoose from "mongoose";

const ExtractionReportSchema = new mongoose.Schema({
  pdfName: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  parsedCount: {
    type: Number,
    default: 0,
  },
  skippedCount: {
    type: Number,
    default: 0,
  },
  autoApprovedCount: {
    type: Number,
    default: 0,
  },
  needsReviewCount: {
    type: Number,
    default: 0,
  },
  strategyBreakdown: {
    type: Map,
    of: Number,
    default: {},
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.ExtractionReport || mongoose.model("ExtractionReport", ExtractionReportSchema);
