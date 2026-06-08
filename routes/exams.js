import express from "express";
import dbConnect from "../lib/db.js";
import Exam from "../lib/models/Exam.js";
import Question from "../lib/models/Question.js";
import ActivityLog from "../lib/models/ActivityLog.js";
import Result from "../lib/models/Result.js";
import { requireAuth } from "../lib/auth.js";

const router = express.Router();

// GET: Retrieve list of exams
router.get("/", requireAuth(), async (req, res) => {
  try {
    await dbConnect();
    const user = req.user;

    if (user.role === "student") {
      // Find all results for this student to get attempted exam IDs
      const results = await Result.find({ user: user._id }).select("exam");
      const attemptedExamIds = results.map((r) => r.exam);

      // Students only see published exams matching their batch, excluding attempted ones
      const exams = await Exam.find({
        status: "published",
        assignedBatches: user.batch,
        _id: { $nin: attemptedExamIds },
      })
        .select("-questions") // Hide questions list until attempt starts
        .populate("createdBy", "name email")
        .sort({ createdAt: -1 });
      
      return res.json({ exams });
    } else {
      // Admins and Super Admins
      if (user.role === "admin" && !user.permissions.includes("manage_exams")) {
        return res.status(403).json({ error: "Access Denied: Missing manage_exams permission" });
      }

      const exams = await Exam.find({}).populate("createdBy", "name email").sort({ createdAt: -1 });
      return res.json({ exams });
    }
  } catch (error) {
    console.error("GET exams error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Create a new exam
router.post("/", requireAuth(["super_admin", "admin"], "manage_exams"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;

    const {
      name,
      description,
      duration,
      passingMarks,
      negativeMarking,
      examType,
      assignedBatches,
      autoSelect,
      autoSelectCount,
      subjectFilter,
      difficultyFilter,
      questions,
    } = req.body;

    if (!name || !duration || !passingMarks) {
      return res.status(400).json({ error: "Name, duration, and passing marks are required." });
    }

    let finalQuestions = [];

    if (autoSelect) {
      const count = parseInt(autoSelectCount || "10");
      
      // Build search query
      const query = {};
      if (subjectFilter) query.subject = subjectFilter;
      if (difficultyFilter) query.difficulty = difficultyFilter;

      // Select random questions
      const pool = await Question.find(query);
      if (pool.length === 0) {
        return res.status(400).json({ error: "No questions match the filters to auto-select." });
      }

      // Shuffle and slice
      const shuffled = pool.sort(() => 0.5 - Math.random());
      finalQuestions = shuffled.slice(0, count).map(q => q._id);
    } else {
      finalQuestions = questions || [];
    }

    const newExam = await Exam.create({
      name,
      description,
      duration: parseInt(duration),
      totalQuestions: finalQuestions.length,
      passingMarks: parseInt(passingMarks),
      negativeMarking: parseFloat(negativeMarking || "0"),
      examType: examType || "Practice",
      questions: finalQuestions,
      assignedBatches: assignedBatches || ["General"],
      status: "draft",
      createdBy: adminUser._id,
    });

    // Audit log
    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "EXAM_CREATED",
      details: `Created exam "${name}" with ${finalQuestions.length} questions.`,
    });

    return res.json({
      message: "Exam created successfully in draft mode.",
      exam: newExam,
    });
  } catch (error) {
    console.error("POST exam error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET: Fetch details of a specific exam
router.get("/:id", requireAuth(), async (req, res) => {
  try {
    await dbConnect();
    const user = req.user;
    const { id } = req.params;

    if (user.role === "student") {
      const exam = await Exam.findOne({
        _id: id,
        status: "published",
        assignedBatches: user.batch,
      }).select("-questions").populate("createdBy", "name email");
      
      if (!exam) {
        return res.status(404).json({ error: "Exam not found or unavailable." });
      }
      return res.json({ exam });
    } else {
      if (user.role === "admin" && !user.permissions.includes("manage_exams")) {
        return res.status(403).json({ error: "Forbidden: Missing manage_exams permission" });
      }

      const exam = await Exam.findById(id).populate("questions").populate("createdBy", "name email");
      if (!exam) {
        return res.status(404).json({ error: "Exam not found." });
      }
      return res.json({ exam });
    }
  } catch (error) {
    console.error("GET exam by ID error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH: Update exam settings, publish/unpublish, or duplicate
router.patch("/:id", requireAuth(["super_admin", "admin"], "manage_exams"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { id } = req.params;
    const { duplicate, ...updates } = req.body;

    const exam = await Exam.findById(id);
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    // Handle Duplication Workflow
    if (duplicate) {
      const duplicatedExam = await Exam.create({
        name: `Copy of ${exam.name}`,
        description: exam.description,
        duration: exam.duration,
        totalQuestions: exam.totalQuestions,
        passingMarks: exam.passingMarks,
        negativeMarking: exam.negativeMarking,
        examType: exam.examType,
        questions: exam.questions,
        assignedBatches: exam.assignedBatches,
        status: "draft",
        createdBy: adminUser._id,
      });

      await ActivityLog.create({
        user: adminUser._id,
        userEmail: adminUser.email,
        action: "EXAM_DUPLICATED",
        details: `Duplicated exam "${exam.name}" to "${duplicatedExam.name}".`,
      });

      return res.json({
        message: "Exam duplicated successfully.",
        exam: duplicatedExam,
      });
    }

    // Standard updates
    const fields = [
      "name",
      "description",
      "duration",
      "passingMarks",
      "negativeMarking",
      "examType",
      "status",
      "assignedBatches",
      "questions",
      "scheduledFor",
    ];

    let changes = [];
    fields.forEach((field) => {
      if (updates[field] !== undefined) {
        exam[field] = updates[field];
        changes.push(field);
      }
    });

    const wasPublished = exam.status === "published";

    if (updates.questions) {
      exam.totalQuestions = updates.questions.length;
    }

    await exam.save();

    // Trigger email alerts to students when an exam is published
    if (exam.status === "published" && !wasPublished) {
      (async () => {
        try {
          const User = (await import("../lib/models/User.js")).default;
          const { sendExamAssignedEmail } = await import("../lib/brevo.js");
          
          const students = await User.find({
            role: "student",
            status: "active",
            batch: { $in: exam.assignedBatches }
          });
          
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
          const examUrl = `${appUrl}/student/exams`;
          
          for (const s of students) {
            sendExamAssignedEmail({
              name: s.name,
              email: s.email,
              examName: exam.name,
              duration: exam.duration,
              passingMarks: exam.passingMarks,
              examUrl
            }).catch(e => console.error(`Error sending exam assigned email to ${s.email}:`, e));
          }
        } catch (err) {
          console.error("Failed to broadcast exam assigned email notifications:", err);
        }
      })();
    }

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "EXAM_UPDATED",
      details: `Updated exam "${exam.name}" fields: ${changes.join(", ")}.`,
    });

    return res.json({
      message: "Exam updated successfully.",
      exam,
    });
  } catch (error) {
    console.error("PATCH exam error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE: Delete an exam
router.delete("/:id", requireAuth(["super_admin", "admin"], "manage_exams"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { id } = req.params;

    const exam = await Exam.findByIdAndDelete(id);
    if (!exam) {
      return res.status(404).json({ error: "Exam not found." });
    }

    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "EXAM_DELETED",
      details: `Deleted exam "${exam.name}".`,
    });

    return res.json({
      message: "Exam deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE exam error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
