import express from "express";
import dbConnect from "../lib/db.js";
import Result from "../lib/models/Result.js";
import User from "../lib/models/User.js";
import { requireAuth } from "../lib/auth.js";

const router = express.Router();

// GET: Fetch student exam stats
router.get("/stats", requireAuth(["student"]), async (req, res) => {
  try {
    await dbConnect();
    const student = req.user;

    // Fetch all results for this student
    const results = await Result.find({ user: student._id });

    const totalExamsAttempted = results.length;
    let totalScore = 0;
    let totalAccuracy = 0;
    let passedCount = 0;

    results.forEach((r) => {
      totalScore += r.score;
      totalAccuracy += r.accuracy;
      if (r.passed) passedCount++;
    });

    const averageAccuracy = totalExamsAttempted > 0 ? Math.round(totalAccuracy / totalExamsAttempted) : 0;
    const passRate = totalExamsAttempted > 0 ? Math.round((passedCount / totalExamsAttempted) * 100) : 0;

    // Fetch student model info to get up-to-date XP & streak
    const studentDoc = await User.findById(student._id);

    return res.json({
      stats: {
        totalExamsAttempted,
        averageAccuracy,
        passRate,
        passedCount,
        failedCount: totalExamsAttempted - passedCount,
        xp: studentDoc ? studentDoc.xp : (student.xp || 0),
        streak: studentDoc ? studentDoc.streak : (student.streak || 0),
      }
    });
  } catch (error) {
    console.error("GET student stats analytics error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET: Group incorrect and correct answers by subject (weak topics)
router.get("/weak-topics", requireAuth(["student"]), async (req, res) => {
  try {
    await dbConnect();
    const student = req.user;

    // Fetch all results for this student, populated with question subject details
    const results = await Result.find({ user: student._id }).populate("answersSnapshot.question");

    // Group incorrect and correct answers by subject
    const subjectStats = {};

    results.forEach((resDoc) => {
      resDoc.answersSnapshot.forEach((ans) => {
        const q = ans.question;
        if (!q) return;

        const subject = q.subject || "General Medicine";
        if (!subjectStats[subject]) {
          subjectStats[subject] = {
            subject,
            correct: 0,
            incorrect: 0,
            total: 0,
          };
        }

        subjectStats[subject].total++;
        if (ans.isCorrect) {
          subjectStats[subject].correct++;
        } else if (ans.selectedOption !== null && ans.selectedOption !== undefined) {
          // If they selected a wrong option (excluding skipped questions)
          subjectStats[subject].incorrect++;
        }
      });
    });

    // Convert to array and calculate accuracy
    const analytics = Object.values(subjectStats).map((item) => {
      const accuracy = item.total > 0 ? Math.round((item.correct / item.total) * 100) : 0;
      return {
        ...item,
        accuracy,
      };
    });

    // Sort by accuracy ascending to show weak topics first
    analytics.sort((a, b) => a.accuracy - b.accuracy);

    return res.json({
      analytics,
    });
  } catch (error) {
    console.error("GET weak topics analytics error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
