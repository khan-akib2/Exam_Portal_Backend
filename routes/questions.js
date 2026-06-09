import express from "express";
import multer from "multer";
import dbConnect from "../lib/db.js";
import Question from "../lib/models/Question.js";
import DraftQuestion from "../lib/models/DraftQuestion.js";
import ExtractionTemplate from "../lib/models/ExtractionTemplate.js";
import ExtractionReport from "../lib/models/ExtractionReport.js";
import ActivityLog from "../lib/models/ActivityLog.js";
import { requireAuth } from "../lib/auth.js";
import { uploadImage } from "../lib/cloudinary.js";
import { parsePdfToQuestions } from "../lib/pdfParser.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 } // Enforce 20MB maximum file size limit
});

function escapeRegex(string) {
  return typeof string === "string"
    ? string.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&")
    : "";
}

// GET: Fetch list of questions (supports filters)
router.get("/", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const { subject, difficulty, search } = req.query;

    const query = {};
    if (subject) query.subject = subject;
    if (difficulty) query.difficulty = difficulty;
    if (search) {
      const cleanSearch = escapeRegex(search);
      query.question = { $regex: cleanSearch, $options: "i" };
    }

    const questions = await Question.find(query).select('-image').sort({ createdAt: -1 });
    return res.json({ questions });
  } catch (error) {
    console.error("GET questions error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Create a single question
router.post("/", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { question, options, correctAnswer, explanation, subject, chapter, difficulty, imageBase64 } = req.body;

    if (!question || !options || options.length < 2 || correctAnswer === undefined) {
      return res.status(400).json({ error: "Question, options (at least 2), and correct answer are required." });
    }

    let imageUrl = null;
    if (imageBase64) {
      imageUrl = await uploadImage(imageBase64, `question_${subject || "general"}`);
    }

    const newQuestion = await Question.create({
      question,
      options,
      correctAnswer: parseInt(correctAnswer),
      explanation,
      subject: subject || "General Medicine",
      chapter,
      difficulty: difficulty || "Medium",
      image: imageUrl,
    });

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "QUESTION_CREATED",
      details: `Created question: "${question.substring(0, 40)}..." in subject "${subject}".`,
    });

    return res.json({
      message: "Question created successfully.",
      question: newQuestion,
    });
  } catch (error) {
    console.error("POST question error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE: Bulk delete questions from pool
router.delete("/", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { questionIds } = req.body;

    if (!questionIds || !Array.isArray(questionIds) || questionIds.length === 0) {
      return res.status(400).json({ error: "A non-empty array of questionIds is required." });
    }

    const deleteResult = await Question.deleteMany({ _id: { $in: questionIds } });

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "QUESTIONS_BULK_DELETED",
      details: `Bulk deleted ${deleteResult.deletedCount} questions from the pool.`,
    });

    return res.json({
      message: `Successfully deleted ${deleteResult.deletedCount} questions from the pool.`,
      count: deleteResult.deletedCount
    });
  } catch (error) {
    console.error("DELETE bulk questions error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// GET: Fetch list of templates
router.get("/templates", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const templates = await ExtractionTemplate.find({}).sort({ createdAt: -1 });
    return res.json({ templates });
  } catch (error) {
    console.error("GET templates error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Create a new template manually
router.post("/templates", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const { templateName, answerPattern, matchingKeywords } = req.body;

    if (!templateName || !answerPattern) {
      return res.status(400).json({ error: "Template name and answer pattern are required." });
    }

    const template = await ExtractionTemplate.create({
      templateName,
      answerPattern,
      matchingKeywords: matchingKeywords || []
    });

    return res.json({
      message: "Template created successfully.",
      template
    });
  } catch (error) {
    console.error("POST template error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// GET: Fetch drafts list and unique PDF list
router.get("/drafts", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const { pdfName, status } = req.query;

    const query = {};
    if (pdfName) query.pdfName = pdfName;
    if (status) query.status = status;

    const drafts = await DraftQuestion.find(query).select('-image').sort({ createdAt: -1 });
    const pdfNames = await DraftQuestion.distinct("pdfName");

    return res.json({ drafts, pdfNames });
  } catch (error) {
    console.error("GET drafts error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Handles bulk operations on drafts (publish, delete, edit)
router.post("/drafts", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { action, draftIds, fields } = req.body;

    if (!action || !draftIds || !Array.isArray(draftIds) || draftIds.length === 0) {
      return res.status(400).json({ error: "Action and a non-empty array of draftIds are required." });
    }

    if (action === "publish") {
      const draftsToPublish = await DraftQuestion.find({ _id: { $in: draftIds } });
      if (draftsToPublish.length === 0) {
        return res.status(404).json({ error: "No matching drafts found to publish." });
      }

      // Pre-publish validation check
      const validDrafts = [];
      const invalidDrafts = [];
      for (const draft of draftsToPublish) {
        const errors = [];
        if (!draft.question || !draft.question.trim()) {
          errors.push("missing question text");
        }
        if (!draft.options || draft.options.length < 2) {
          errors.push("must have at least 2 options");
        } else if (draft.options.some(opt => !opt || !opt.trim())) {
          errors.push("has one or more empty options");
        }
        if (draft.correctAnswer === undefined || draft.correctAnswer === null || isNaN(draft.correctAnswer) || draft.correctAnswer < 0 || draft.correctAnswer >= draft.options.length) {
          errors.push("invalid correct option index");
        }
        if (!draft.subject || !draft.subject.trim()) {
          errors.push("missing subject");
        }

        if (errors.length > 0) {
          invalidDrafts.push({
            id: draft._id,
            num: draft.num || "N/A",
            page: draft.pageNum || "N/A",
            errors
          });
        } else {
          validDrafts.push(draft);
        }
      }

      if (validDrafts.length === 0) {
        const errorDetails = invalidDrafts
          .map(d => `Question #${d.num} (Page ${d.page}): ${d.errors.join(", ")}`)
          .join("; ");
        return res.status(400).json({
          error: `Cannot publish: All selected drafts have validation errors. Details: ${errorDetails}.`
        });
      }

      const publishedQuestions = [];
      for (const draft of validDrafts) {
        const publishedQ = await Question.create({
          question: draft.question,
          options: draft.options,
          correctAnswer: draft.correctAnswer,
          explanation: draft.explanation,
          subject: draft.subject,
          chapter: draft.chapter,
          difficulty: draft.difficulty,
          image: draft.image,
          tags: draft.tags || [],
        });
        publishedQuestions.push(publishedQ);
      }

      // Delete only drafts that were successfully published
      const publishedIds = validDrafts.map(d => d._id);
      await DraftQuestion.deleteMany({ _id: { $in: publishedIds } });

      await ActivityLog.create({
        user: adminUser._id,
        userEmail: adminUser.email,
        action: "QUESTIONS_BULK_PUBLISHED",
        details: `Published ${publishedQuestions.length} questions from PDF drafts.`,
      });

      let message = `Successfully published ${publishedQuestions.length} questions to the main pool.`;
      if (invalidDrafts.length > 0) {
        message += ` ${invalidDrafts.length} draft(s) were skipped due to validation errors. Please review and edit them in the Review Queue.`;
      }

      return res.json({
        message,
        count: publishedQuestions.length,
        skippedCount: invalidDrafts.length,
        invalidDrafts
      });
    }

    if (action === "delete") {
      const deleteResult = await DraftQuestion.deleteMany({ _id: { $in: draftIds } });

      await ActivityLog.create({
        user: adminUser._id,
        userEmail: adminUser.email,
        action: "QUESTIONS_BULK_DELETED",
        details: `Deleted ${deleteResult.deletedCount} draft questions from Review Queue.`,
      });

      return res.json({
        message: `Successfully deleted ${deleteResult.deletedCount} drafts.`,
        count: deleteResult.deletedCount
      });
    }

    if (action === "edit") {
      if (!fields || typeof fields !== "object") {
        return res.status(400).json({ error: "Fields object is required for edit action." });
      }

      const updateData = {};
      if (fields.subject) updateData.subject = fields.subject;
      if (fields.difficulty) updateData.difficulty = fields.difficulty;
      if (fields.tags) updateData.tags = fields.tags;
      if (fields.chapter !== undefined) updateData.chapter = fields.chapter;

      const updateResult = await DraftQuestion.updateMany(
        { _id: { $in: draftIds } },
        { $set: updateData }
      );

      await ActivityLog.create({
        user: adminUser._id,
        userEmail: adminUser.email,
        action: "QUESTIONS_BULK_EDITED",
        details: `Bulk edited ${updateResult.modifiedCount} draft questions.`,
      });

      return res.json({
        message: `Successfully updated ${updateResult.modifiedCount} drafts.`,
        count: updateResult.modifiedCount
      });
    }

    return res.status(400).json({ error: `Unsupported bulk action: ${action}` });
  } catch (error) {
    console.error("POST drafts error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// GET: Fetch draft analytics
router.get("/drafts/analytics", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const { pdfName } = req.query;

    const filter = {};
    if (pdfName) {
      filter.pdfName = pdfName;
    }

    const totalCount = await DraftQuestion.countDocuments(filter);
    const autoApprovedCount = await DraftQuestion.countDocuments({ ...filter, status: "Auto Approved" });
    const needsReviewCount = await DraftQuestion.countDocuments({ ...filter, status: "Needs Review" });
    const publishedCount = await DraftQuestion.countDocuments({ ...filter, status: "Published" });

    let skippedCount = 0;
    let strategyBreakdown = {};

    if (pdfName) {
      const report = await ExtractionReport.findOne({ pdfName });
      if (report) {
        skippedCount = report.skippedCount || 0;
        if (report.strategyBreakdown) {
          strategyBreakdown = Object.fromEntries(report.strategyBreakdown);
        }
      }
    } else {
      const allReports = await ExtractionReport.find({});
      allReports.forEach(r => {
        skippedCount += r.skippedCount || 0;
        if (r.strategyBreakdown) {
          const breakdownObj = Object.fromEntries(r.strategyBreakdown);
          Object.entries(breakdownObj).forEach(([strat, cnt]) => {
            strategyBreakdown[strat] = (strategyBreakdown[strat] || 0) + cnt;
          });
        }
      });
    }

    return res.json({
      total: totalCount,
      autoApproved: autoApprovedCount,
      needsReview: needsReviewCount,
      published: publishedCount,
      skipped: skippedCount,
      strategyBreakdown
    });
  } catch (error) {
    console.error("GET drafts analytics error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// POST: Extraction Wizard Consensus Pattern Learner
router.post("/drafts/learn-pattern", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { pdfName, selections, templateName } = req.body;

    if (!pdfName || !selections || !Array.isArray(selections) || selections.length === 0 || !templateName) {
      return res.status(400).json({ error: "pdfName, selections array, and templateName are required." });
    }

    // 1. Fetch the sample drafts
    const selectionIds = selections.map(s => s.draftId);
    const drafts = await DraftQuestion.find({ _id: { $in: selectionIds } });

    if (drafts.length === 0) {
      return res.status(404).json({ error: "No matching sample drafts found in database." });
    }

    // 2. Identify style or symbol pattern
    const candidatePatterns = {
      bold_option: true,
      highlight_option: true,
      underline_option: true,
      colored_option: true,
      plus_symbol: true,
      checkmark_symbol: true,
      asterisk_symbol: true
    };

    for (const sel of selections) {
      const draft = drafts.find(d => d._id.toString() === sel.draftId);
      if (!draft) continue;

      const chosenIdx = parseInt(sel.chosenIndex);
      const metadata = draft.optionMetadata || [];
      const options = draft.options || [];

      const isFeatureUnique = (featureName) => {
        const chosenOpt = metadata[chosenIdx];
        if (!chosenOpt || !chosenOpt[featureName]) return false;
        
        for (let i = 0; i < metadata.length; i++) {
          if (i === chosenIdx) continue;
          if (metadata[i] && metadata[i][featureName] === true) {
            return false;
          }
        }
        return true;
      };

      const isSymbolUnique = (symbolRegex) => {
        const chosenText = options[chosenIdx] || "";
        if (!symbolRegex.test(chosenText)) return false;

        for (let i = 0; i < options.length; i++) {
          if (i === chosenIdx) continue;
          if (options[i] && symbolRegex.test(options[i])) {
            return false;
          }
        }
        return true;
      };

      if (!isFeatureUnique("isBold")) candidatePatterns.bold_option = false;
      if (!isFeatureUnique("isHighlighted")) candidatePatterns.highlight_option = false;
      if (!isFeatureUnique("isUnderlined")) candidatePatterns.underline_option = false;
      if (!isFeatureUnique("isColored")) candidatePatterns.colored_option = false;
      if (!isSymbolUnique(/\(\+\)|\[\+\]|\+/)) candidatePatterns.plus_symbol = false;
      if (!isSymbolUnique(/✓|✔/)) candidatePatterns.checkmark_symbol = false;
      if (!isSymbolUnique(/\*/)) candidatePatterns.asterisk_symbol = false;
    }

    let learnedPattern = null;
    if (candidatePatterns.highlight_option) {
      learnedPattern = "highlight_option";
    } else if (candidatePatterns.bold_option) {
      learnedPattern = "bold_option";
    } else if (candidatePatterns.underline_option) {
      learnedPattern = "underline_option";
    } else if (candidatePatterns.colored_option) {
      learnedPattern = "colored_option";
    } else if (candidatePatterns.plus_symbol) {
      learnedPattern = "plus_symbol";
    } else if (candidatePatterns.checkmark_symbol) {
      learnedPattern = "checkmark_symbol";
    } else if (candidatePatterns.asterisk_symbol) {
      learnedPattern = "asterisk_symbol";
    }

    if (!learnedPattern) {
      learnedPattern = "mixed_formats"; 
      console.warn("Could not find unique pattern, defaulting to mixed_formats.");
    }

    // Save template
    const fileBasename = pdfName.replace(/\.[^/.]+$/, "");
    const template = await ExtractionTemplate.findOneAndUpdate(
      { templateName },
      {
        templateName,
        answerPattern: learnedPattern,
        $addToSet: { matchingKeywords: fileBasename.toLowerCase() }
      },
      { upsert: true, returnDocument: "after" }
    );

    // Re-evaluate drafts
    const allPdfDrafts = await DraftQuestion.find({ pdfName });
    
    let autoApprovedCount = 0;
    for (const draft of allPdfDrafts) {
      const metadata = draft.optionMetadata || [];
      const options = draft.options || [];
      let matchedIndex = -1;
      let matchesCount = 0;

      options.forEach((optText, idx) => {
        const optMeta = metadata[idx] || {};
        let isMatch = false;
        if (learnedPattern === "mixed_formats") {
          if (optMeta.isHighlighted || optMeta.isBold || optMeta.isUnderlined || optMeta.isColored || 
              /\(\+\)|\[\+\]|\+/.test(optText) || /✓|✔/.test(optText) || /\*/.test(optText)) {
            isMatch = true;
          }
        } else {
          if (learnedPattern === "highlight_option" && optMeta.isHighlighted) isMatch = true;
          if (learnedPattern === "bold_option" && optMeta.isBold) isMatch = true;
          if (learnedPattern === "underline_option" && optMeta.isUnderlined) isMatch = true;
          if (learnedPattern === "colored_option" && optMeta.isColored) isMatch = true;
          if (learnedPattern === "plus_symbol" && /\(\+\)|\[\+\]|\+/.test(optText)) isMatch = true;
          if (learnedPattern === "checkmark_symbol" && /✓|✔/.test(optText)) isMatch = true;
          if (learnedPattern === "asterisk_symbol" && /\*/.test(optText)) isMatch = true;
        }

        if (isMatch) {
          matchedIndex = idx;
          matchesCount++;
        }
      });

      if (matchesCount === 1) {
        draft.correctAnswer = matchedIndex;
        draft.confidenceScore = 98;
        draft.matchStrategy = learnedPattern;
        draft.status = "Auto Approved";
        autoApprovedCount++;
      } else {
        const manualSel = selections.find(s => s.draftId === draft._id.toString());
        if (manualSel) {
          draft.correctAnswer = parseInt(manualSel.chosenIndex);
          draft.confidenceScore = 100;
          draft.matchStrategy = "manual_wizard";
          draft.status = "Auto Approved";
          autoApprovedCount++;
        } else {
          draft.confidenceScore = 40;
          draft.matchStrategy = "none";
          draft.status = "Needs Review";
        }
      }

      if (["plus_symbol", "checkmark_symbol", "asterisk_symbol"].includes(learnedPattern)) {
        draft.options = draft.options.map(opt => opt.replace(/\(\+\)|\[\+\]|\+|✓|✔|\*/g, "").trim());
      }

      await draft.save();
    }

    const updatedDrafts = await DraftQuestion.find({ pdfName }).sort({ createdAt: -1 });
    const strategyCounts = {};
    let parsedCount = 0;
    let skippedCount = 0;
    let autoApprovedCountReport = 0;
    let needsReviewCountReport = 0;

    const existingReport = await ExtractionReport.findOne({ pdfName });
    if (existingReport) {
      skippedCount = existingReport.skippedCount || 0;
    }

    updatedDrafts.forEach(q => {
      parsedCount++;
      const strategy = q.matchStrategy || "none";
      strategyCounts[strategy] = (strategyCounts[strategy] || 0) + 1;
      if (q.status === "Auto Approved" || q.status === "Published") {
        autoApprovedCountReport++;
      } else {
        needsReviewCountReport++;
      }
    });

    await ExtractionReport.findOneAndUpdate(
      { pdfName },
      {
        pdfName,
        parsedCount,
        skippedCount,
        autoApprovedCount: autoApprovedCountReport,
        needsReviewCount: needsReviewCountReport,
        strategyBreakdown: strategyCounts,
        createdAt: new Date()
      },
      { upsert: true }
    );

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "TEMPLATE_LEARNED_WIZARD",
      details: `Learned pattern "${learnedPattern}" for template "${templateName}" from PDF "${pdfName}". Re-processed ${allPdfDrafts.length} drafts.`,
    });

    return res.json({
      message: `Template "${templateName}" learned successfully. Re-evaluated and auto-approved ${autoApprovedCount} questions.`,
      template,
      drafts: updatedDrafts,
      autoApprovedCount,
      pattern: learnedPattern
    });
  } catch (error) {
    console.error("POST learn-pattern error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// POST: PDF Upload and Extraction Endpoint
router.post("/upload-pdf", requireAuth(["super_admin", "admin"], "manage_questions"), upload.fields([
  { name: "file", maxCount: 1 },
  { name: "answersFile", maxCount: 1 }
]), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;

    const file = req.files && req.files["file"] ? req.files["file"][0] : null;
    const answersFile = req.files && req.files["answersFile"] ? req.files["answersFile"][0] : null;
    const preSelectedTemplateId = req.body.templateId;

    if (!file) {
      return res.status(400).json({ error: "No PDF file uploaded." });
    }

    if (file.mimetype !== "application/pdf" && !file.originalname.endsWith(".pdf")) {
      return res.status(400).json({ error: "Only PDF files are supported." });
    }

    console.log(`Uploading: ${file.originalname}, size: ${file.size} bytes`);
    const pdfBuffer = file.buffer;
    const answersBuffer = answersFile ? answersFile.buffer : null;

    // 1. Resolve template if pre-selected or if matching keyword exists
    let activeTemplate = null;
    if (preSelectedTemplateId) {
      activeTemplate = await ExtractionTemplate.findById(preSelectedTemplateId);
    } else {
      const templates = await ExtractionTemplate.find({});
      for (const t of templates) {
        for (const keyword of t.matchingKeywords || []) {
          if (file.originalname.toLowerCase().includes(keyword.toLowerCase())) {
            activeTemplate = t;
            console.log(`Auto-matched template "${t.templateName}" based on keyword "${keyword}"`);
            break;
          }
        }
        if (activeTemplate) break;
      }
    }

    // 2. Parse PDF to MCQs
    const parseResult = await parsePdfToQuestions(pdfBuffer, file.originalname, activeTemplate, answersBuffer);
    let extractedQuestions = parseResult.questions || [];
    let skippedCount = parseResult.skippedCount || 0;

    // 3. Auto-Detect Consensus pattern if no template was applied
    if (!activeTemplate && extractedQuestions.length > 0) {
      const patternsCount = {};
      extractedQuestions.forEach(q => {
        if (q.matchStrategy && q.matchStrategy !== "none") {
          patternsCount[q.matchStrategy] = (patternsCount[q.matchStrategy] || 0) + 1;
        }
      });

      const uniquePatternsCount = Object.keys(patternsCount).length;
      let finalPattern = null;

      if (uniquePatternsCount > 1) {
        finalPattern = "mixed_formats";
      } else if (uniquePatternsCount === 1) {
        finalPattern = Object.keys(patternsCount)[0];
      }

      if (finalPattern) {
        console.log(`Auto-detected pattern: "${finalPattern}"`);
        
        if (finalPattern !== "mixed_formats") {
          const dummyTemplate = { answerPattern: finalPattern };
          const reParseResult = await parsePdfToQuestions(pdfBuffer, file.originalname, dummyTemplate, answersBuffer);
          extractedQuestions = reParseResult.questions || [];
          skippedCount = reParseResult.skippedCount || 0;
        }

        const existingT = await ExtractionTemplate.findOne({ answerPattern: finalPattern });
        if (!existingT) {
          try {
            await ExtractionTemplate.create({
              templateName: `Auto-Learned Template ${finalPattern.toUpperCase()}`,
              answerPattern: finalPattern,
              matchingKeywords: [file.originalname.replace(/\.[^/.]+$/, "")]
            });
          } catch (e) {
            console.warn("Failed to create auto-detected template:", e.message);
          }
        }
      }
    }

    // 4. Clear any previous drafts from the same file
    await DraftQuestion.deleteMany({ pdfName: file.originalname });

    // 5. Store questions in Drafts collection
    const savedDrafts = [];
    const batchSize = 100;
    for (let i = 0; i < extractedQuestions.length; i += batchSize) {
      const batch = extractedQuestions.slice(i, i + batchSize).map(q => ({
        ...q,
        pdfName: file.originalname
      }));
      const inserted = await DraftQuestion.insertMany(batch);
      savedDrafts.push(...inserted);
    }

    // 6. Generate booklet extraction stats report
    const strategyCounts = {};
    savedDrafts.forEach(q => {
      const strategy = q.matchStrategy || "none";
      strategyCounts[strategy] = (strategyCounts[strategy] || 0) + 1;
    });

    const lowConfidenceCount = savedDrafts.filter(d => d.confidenceScore < 90).length;
    const autoApprovedCount = savedDrafts.length - lowConfidenceCount;
    const needsReviewCount = lowConfidenceCount;

    await ExtractionReport.findOneAndUpdate(
      { pdfName: file.originalname },
      {
        pdfName: file.originalname,
        parsedCount: savedDrafts.length,
        skippedCount,
        autoApprovedCount,
        needsReviewCount,
        strategyBreakdown: strategyCounts,
        createdAt: new Date()
      },
      { upsert: true }
    );

    const requireWizard = savedDrafts.length > 0 && (lowConfidenceCount / savedDrafts.length) > 0.4;

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "PDF_UPLOADED",
      details: `Uploaded PDF "${file.originalname}". Extracted ${savedDrafts.length} drafts (skipped ${skippedCount}). Wizard Required: ${requireWizard}.`,
    });

    const sampleQuestions = requireWizard ? savedDrafts.slice(0, Math.min(20, savedDrafts.length)) : [];

    return res.json({
      message: `PDF parsed. Extracted ${savedDrafts.length} drafts.`,
      pdfName: file.originalname,
      requireWizard,
      samples: sampleQuestions,
      draftsCount: savedDrafts.length,
      autoApprovedCount,
      skippedCount
    });
  } catch (error) {
    console.error("POST PDF upload API error:", error);
    return res.status(500).json({ error: "Failed to parse PDF: " + error.message });
  }
});

// GET: Fetch details of a single draft
router.get("/drafts/:id", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const draft = await DraftQuestion.findById(req.params.id);
    if (!draft) {
      return res.status(404).json({ error: "Draft question not found." });
    }
    return res.json({ draft });
  } catch (error) {
    console.error("GET draft error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH: Update a single draft
router.patch("/drafts/:id", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const { id } = req.params;
    const { question, options, correctAnswer, explanation, subject, chapter, difficulty, tags, imageBase64, image } = req.body;

    const updateData = {};
    if (question !== undefined) updateData.question = question;
    if (options !== undefined) updateData.options = options;
    if (correctAnswer !== undefined) updateData.correctAnswer = parseInt(correctAnswer);
    if (explanation !== undefined) updateData.explanation = explanation;
    if (subject !== undefined) updateData.subject = subject;
    if (chapter !== undefined) updateData.chapter = chapter;
    if (difficulty !== undefined) updateData.difficulty = difficulty;
    if (tags !== undefined) updateData.tags = tags;
    
    if (image !== undefined) updateData.image = image;
    if (imageBase64) {
      const imageUrl = await uploadImage(imageBase64, `draft_${id}`);
      updateData.image = imageUrl;
    }

    updateData.confidenceScore = 100;
    updateData.status = "Auto Approved";

    const updatedDraft = await DraftQuestion.findByIdAndUpdate(id, updateData, { returnDocument: 'after' });
    if (!updatedDraft) {
      return res.status(404).json({ error: "Draft question not found." });
    }

    return res.json({
      message: "Draft updated successfully.",
      draft: updatedDraft
    });
  } catch (error) {
    console.error("PATCH single draft error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// DELETE: Delete a single draft
router.delete("/drafts/:id", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const { id } = req.params;
    const deletedDraft = await DraftQuestion.findByIdAndDelete(id);
    if (!deletedDraft) {
      return res.status(404).json({ error: "Draft question not found." });
    }
    return res.json({ message: "Draft deleted successfully." });
  } catch (error) {
    console.error("DELETE single draft error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// POST: Publish a single draft question to the pool
router.post("/drafts/:id", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { id } = req.params;

    const draft = await DraftQuestion.findById(id);
    if (!draft) {
      return res.status(404).json({ error: "Draft question not found." });
    }

    const errors = [];
    if (!draft.question || !draft.question.trim()) errors.push("missing question text");
    if (!draft.options || draft.options.length < 2) {
      errors.push("must have at least 2 options");
    } else if (draft.options.some(opt => !opt || !opt.trim())) {
      errors.push("has one or more empty options");
    }
    if (draft.correctAnswer === undefined || draft.correctAnswer === null || isNaN(draft.correctAnswer) || draft.correctAnswer < 0 || draft.correctAnswer >= draft.options.length) {
      errors.push("invalid correct option index");
    }
    if (!draft.subject || !draft.subject.trim()) errors.push("missing subject");

    if (errors.length > 0) {
      return res.status(400).json({
        error: `Cannot publish: Draft question has validation errors: ${errors.join(", ")}.`
      });
    }

    const publishedQ = await Question.create({
      question: draft.question,
      options: draft.options,
      correctAnswer: draft.correctAnswer,
      explanation: draft.explanation,
      subject: draft.subject,
      chapter: draft.chapter,
      difficulty: draft.difficulty,
      image: draft.image,
      tags: draft.tags || [],
    });

    await DraftQuestion.findByIdAndDelete(id);

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "QUESTION_PUBLISHED",
      details: `Published single question: "${publishedQ.question.substring(0, 40)}..."`,
    });

    return res.json({
      message: "Question published successfully to main pool.",
      question: publishedQ
    });
  } catch (error) {
    console.error("POST single draft publish error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

// GET: Fetch details of a specific question
router.get("/:id", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const q = await Question.findById(req.params.id);
    if (!q) {
      return res.status(404).json({ error: "Question not found." });
    }
    return res.json({ question: q });
  } catch (error) {
    console.error("GET question by ID error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH: Update a question
router.patch("/:id", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { id } = req.params;
    const { question, options, correctAnswer, explanation, subject, chapter, difficulty, imageBase64, removeImage } = req.body;

    const q = await Question.findById(id);
    if (!q) {
      return res.status(404).json({ error: "Question not found." });
    }

    if (question !== undefined) q.question = question;
    if (options !== undefined) q.options = options;
    if (correctAnswer !== undefined) q.correctAnswer = parseInt(correctAnswer);
    if (explanation !== undefined) q.explanation = explanation;
    if (subject !== undefined) q.subject = subject;
    if (chapter !== undefined) q.chapter = chapter;
    if (difficulty !== undefined) q.difficulty = difficulty;

    if (removeImage) {
      q.image = null;
    } else if (imageBase64) {
      q.image = await uploadImage(imageBase64, `question_${subject || q.subject || "general"}`);
    }

    await q.save();

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "QUESTION_UPDATED",
      details: `Updated question ID: ${q._id}.`,
    });

    return res.json({
      message: "Question updated successfully.",
      question: q,
    });
  } catch (error) {
    console.error("PATCH question error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE: Delete a question
router.delete("/:id", requireAuth(["super_admin", "admin"], "manage_questions"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { id } = req.params;

    const q = await Question.findByIdAndDelete(id);
    if (!q) {
      return res.status(404).json({ error: "Question not found." });
    }

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "QUESTION_DELETED",
      details: `Deleted question ID: ${id}.`,
    });

    return res.json({
      message: "Question deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE question error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
