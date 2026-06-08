import mongoose from "mongoose";

const ExtractionTemplateSchema = new mongoose.Schema({
  templateName: {
    type: String,
    required: [true, "Template name is required."],
    unique: true,
    trim: true,
  },
  answerPattern: {
    type: String,
    enum: [
      "plus_symbol",
      "checkmark_symbol",
      "asterisk_symbol",
      "bold_option",
      "colored_option",
      "highlight_option",
      "underline_option",
      "answer_text",
      "end_answer_key",
      "separate_answers",
      "ocr_marker"
    ],
    required: [true, "Answer pattern is required."],
  },
  matchingKeywords: {
    type: [String],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export default mongoose.models.ExtractionTemplate || mongoose.model("ExtractionTemplate", ExtractionTemplateSchema);
