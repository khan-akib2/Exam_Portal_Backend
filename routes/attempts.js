import express from "express";
import dbConnect from "../lib/db.js";
import Exam from "../lib/models/Exam.js";
import Attempt from "../lib/models/Attempt.js";
import Question from "../lib/models/Question.js";
import Result from "../lib/models/Result.js";
import ActivityLog from "../lib/models/ActivityLog.js";
import { requireAuth } from "../lib/auth.js";
import { sendExamCompletionAdminEmail, sendResultAvailableEmail } from "../lib/brevo.js";

const router = express.Router();

// Helper to determine title level based on total XP
function calculateLevel(xp) {
  if (xp >= 2000) return "Master";
  if (xp >= 1000) return "Consultant";
  if (xp >= 500) return "Senior Resident";
  if (xp >= 200) return "Resident";
  return "Intern";
}

// POST: Start or resume an exam session
router.post("/start", requireAuth(["student"]), async (req, res) => {
  try {
    await dbConnect();
    const student = req.user;
    const { examId } = req.body;

    if (!examId) {
      return res.status(400).json({ error: "Exam ID is required." });
    }

    const exam = await Exam.findOne({
      _id: examId,
      status: "published",
      assignedBatches: student.batch,
    });

    if (!exam) {
      return res.status(404).json({ error: "Exam is not available or does not exist." });
    }

    const hasAttempted = await Result.findOne({
      exam: examId,
      user: student._id,
    });
    if (hasAttempted) {
      return res.status(400).json({ error: "You have already attempted this exam." });
    }

    let attempt = await Attempt.findOne({
      exam: examId,
      user: student._id,
      status: "active",
    });

    if (!attempt) {
      const answersArray = exam.questions.map((qId) => ({
        question: qId,
        selectedOption: null,
        isMarkedForReview: false,
        visited: false,
      }));

      if (answersArray.length > 0) {
        answersArray[0].visited = true;
      }

      attempt = await Attempt.create({
        exam: examId,
        user: student._id,
        status: "active",
        answers: answersArray,
        warnings: 0,
        warningLogs: [],
      });
    }

    const questions = await Question.find({ _id: { $in: exam.questions } }).select("-correctAnswer -explanation");

    const orderedQuestions = exam.questions
      .map((qId) => questions.find((q) => q._id.toString() === qId.toString()))
      .filter(Boolean);

    return res.json({
      message: "Exam session loaded successfully.",
      attemptId: attempt._id,
      startedAt: attempt.startedAt,
      warnings: attempt.warnings,
      answers: attempt.answers,
      exam: {
        id: exam._id,
        name: exam.name,
        duration: exam.duration,
        totalQuestions: exam.totalQuestions,
        negativeMarking: exam.negativeMarking,
        passingMarks: exam.passingMarks,
        examType: exam.examType,
      },
      questions: orderedQuestions,
    });
  } catch (error) {
    console.error("POST start attempt error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET: Fetch graded result details for a specific attempt
router.get("/:id/result", requireAuth(), async (req, res) => {
  try {
    await dbConnect();
    const user = req.user;
    const { id } = req.params;

    const result = await Result.findById(id)
      .populate("exam", "name duration totalQuestions negativeMarking passingMarks")
      .populate("answersSnapshot.question");
    
    if (!result) {
      return res.status(404).json({ error: "Result not found." });
    }

    if (user.role === "student" && result.user.toString() !== user._id.toString()) {
      return res.status(403).json({ error: "Forbidden: You cannot view this result." });
    }

    return res.json({ result });
  } catch (error) {
    console.error("GET attempt result error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Save answers and update anti-cheat warnings during an attempt
router.post("/:id/save", requireAuth(["student"]), async (req, res) => {
  try {
    await dbConnect();
    const student = req.user;
    const { id } = req.params;
    const { questionId, selectedOption, isMarkedForReview, visited, warning } = req.body;

    const attempt = await Attempt.findOne({ _id: id, user: student._id, status: "active" });
    if (!attempt) {
      return res.status(404).json({ error: "Active attempt session not found." });
    }

    if (questionId) {
      const answerIndex = attempt.answers.findIndex(
        (ans) => ans.question.toString() === questionId.toString()
      );

      if (answerIndex > -1) {
        if (selectedOption !== undefined) attempt.answers[answerIndex].selectedOption = selectedOption;
        if (isMarkedForReview !== undefined) attempt.answers[answerIndex].isMarkedForReview = isMarkedForReview;
        if (visited !== undefined) attempt.answers[answerIndex].visited = visited;
      }
    }

    if (warning) {
      attempt.warnings += 1;
      attempt.warningLogs.push({
        type: warning.type,
        details: warning.details || "Anti-cheat trigger",
        timestamp: new Date(),
      });
      console.warn(`Anti-cheat violation for user ${student.email}: ${warning.type} (${attempt.warnings} warnings total)`);
    }

    await attempt.save();

    return res.json({
      success: true,
      warningsCount: attempt.warnings,
    });
  } catch (error) {
    console.error("POST save attempt answer error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Submit exam attempt, grade results, award XP/Gamification
router.post("/:id/submit", requireAuth(["student"]), async (req, res) => {
  try {
    await dbConnect();
    const student = req.user;
    const { id } = req.params;

    const attempt = await Attempt.findOne({ _id: id, user: student._id, status: "active" });
    if (!attempt) {
      return res.status(404).json({ error: "Active exam session not found or already submitted." });
    }

    const exam = await Exam.findById(attempt.exam);
    if (!exam) {
      return res.status(404).json({ error: "Associated exam not found." });
    }

    const questions = await Question.find({ _id: { $in: exam.questions } });

    let correctAnswers = 0;
    let wrongAnswers = 0;
    let skippedAnswers = 0;
    const answersSnapshot = [];

    for (const ans of attempt.answers) {
      const q = questions.find((item) => item._id.toString() === ans.question.toString());
      if (!q) continue;

      const isUnanswered = ans.selectedOption === null || ans.selectedOption === undefined;
      const isCorrect = !isUnanswered && ans.selectedOption === q.correctAnswer;

      if (isUnanswered) {
        skippedAnswers++;
      } else if (isCorrect) {
        correctAnswers++;
      } else {
        wrongAnswers++;
      }

      answersSnapshot.push({
        question: q._id,
        selectedOption: ans.selectedOption,
        correctOption: q.correctAnswer,
        isCorrect,
      });

      if (!isUnanswered) {
        if (!q.stats) {
          q.stats = { answeredCorrectly: 0, answeredWrongly: 0 };
        }
        if (isCorrect) {
          q.stats.answeredCorrectly += 1;
        } else {
          q.stats.answeredWrongly += 1;
        }
        await q.save();
      }
    }

    const score = correctAnswers * 1 - wrongAnswers * Math.abs(exam.negativeMarking);

    const totalAttempted = correctAnswers + wrongAnswers;
    const accuracy = totalAttempted > 0 ? Math.round((correctAnswers / totalAttempted) * 100) : 0;

    const now = new Date();
    const timeTaken = Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000);

    const baseXp = correctAnswers * 10;
    
    const passed = score >= exam.passingMarks;
    let streakIncrement = 0;
    
    if (passed) {
      student.streak += 1;
      streakIncrement = student.streak;
    } else {
      student.streak = 0;
    }

    const streakBonus = student.streak > 1 ? student.streak * 5 : 0;
    const totalXpEarned = baseXp + streakBonus;

    const prevLevel = student.level;
    student.xp += totalXpEarned;
    student.level = calculateLevel(student.xp);
    
    const unlockedAchievements = [];
    
    if (!student.achievements.includes("first_exam")) {
      student.achievements.push("first_exam");
      unlockedAchievements.push({
        key: "first_exam",
        title: "First Step",
        description: "Completed your first medical examination attempt!",
        icon: "Zap",
        xpBonus: 50,
      });
      student.xp += 50;
    }

    if (accuracy === 100 && exam.totalQuestions >= 5 && !student.achievements.includes("perfect_accuracy")) {
      student.achievements.push("perfect_accuracy");
      unlockedAchievements.push({
        key: "perfect_accuracy",
        title: "Surgeon Precision",
        description: "Achieved a perfect 100% accuracy on a full test.",
        icon: "Trophy",
        xpBonus: 100,
      });
      student.xp += 100;
    }

    if (student.streak >= 3 && !student.achievements.includes("streak_3")) {
      student.achievements.push("streak_3");
      unlockedAchievements.push({
        key: "streak_3",
        title: "On Fire",
        description: "Maintained a streak of 3 consecutive passed exams.",
        icon: "Flame",
        xpBonus: 75,
      });
      student.xp += 75;
    }

    student.lastActive = new Date();
    await student.save();

    attempt.status = "submitted";
    attempt.submittedAt = now;
    await attempt.save();

    const result = await Result.create({
      exam: exam._id,
      user: student._id,
      attempt: attempt._id,
      score,
      totalQuestions: exam.totalQuestions,
      correctAnswers,
      wrongAnswers,
      skippedAnswers,
      accuracy,
      timeTaken,
      xpEarned: totalXpEarned,
      passed,
      answersSnapshot,
      submittedAt: now,
    });

    await ActivityLog.create({
      user: student._id,
      userEmail: student.email,
      action: "EXAM_SUBMITTED",
      details: `Submitted exam "${exam.name}". Score: ${score}/${exam.totalQuestions}, Accuracy: ${accuracy}%, Passed: ${passed}. Earned ${totalXpEarned} XP.`,
    });

    sendExamCompletionAdminEmail({
      studentName: student.name,
      studentEmail: student.email,
      examName: exam.name,
      score,
      totalQuestions: exam.totalQuestions,
      accuracy,
      timeTaken,
      passed,
      warnings: attempt.warnings,
    }).catch((err) => console.error("Admin notification email failed:", err));

    // Send score details email to student
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const resultUrl = `${appUrl}/student/results/${result._id}`;
    
    sendResultAvailableEmail({
      name: student.name,
      email: student.email,
      examName: exam.name,
      score,
      totalQuestions: exam.totalQuestions,
      accuracy,
      passed,
      resultUrl
    }).catch((err) => console.error("Student scorecard email failed:", err));

    return res.json({
      message: "Exam submitted successfully.",
      resultId: result._id,
      summary: {
        score,
        totalQuestions: exam.totalQuestions,
        correctAnswers,
        wrongAnswers,
        skippedAnswers,
        accuracy,
        timeTaken,
        xpEarned: totalXpEarned,
        passed,
        levelUp: prevLevel !== student.level ? student.level : null,
        newStreak: student.streak,
        unlockedAchievements,
      },
    });
// GET: Fetch all completed attempts for the current student
router.get("/my-attempts", requireAuth(["student"]), async (req, res) => {
  try {
    await dbConnect();
    const student = req.user;
    const results = await Result.find({ user: student._id })
      .populate("exam", "name duration totalQuestions negativeMarking examType")
      .sort({ submittedAt: -1 });
    return res.json({ results });
  } catch (error) {
    console.error("GET my-attempts error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});


export default router;
