import express from "express";
import dbConnect from "../lib/db.js";
import User from "../lib/models/User.js";
import Exam from "../lib/models/Exam.js";
import Question from "../lib/models/Question.js";
import Attempt from "../lib/models/Attempt.js";
import Result from "../lib/models/Result.js";
import ActivityLog from "../lib/models/ActivityLog.js";
import ExtractionReport from "../lib/models/ExtractionReport.js";
import { requireAuth, hashPassword } from "../lib/auth.js";
import { sendStudentWelcomeEmail, sendEmail, sendPasswordResetEmail } from "../lib/brevo.js";

const router = express.Router();

// GET: Gather dashboard stats
router.get("/stats", requireAuth(["super_admin", "admin"]), async (req, res) => {
  try {
    await dbConnect();

    // Count collections
    const totalUsers = await User.countDocuments({ role: "student" });
    const activeUsers = await User.countDocuments({ role: "student", status: "active" });
    const totalExams = await Exam.countDocuments({});
    const totalQuestions = await Question.countDocuments({});
    const completedExams = await Attempt.countDocuments({ status: "submitted" });

    // Aggregate average score & accuracy
    const resultStats = await Result.aggregate([
      {
        $group: {
          _id: null,
          avgScore: { $avg: "$score" },
          avgAccuracy: { $avg: "$accuracy" },
          avgTimeTaken: { $avg: "$timeTaken" },
        },
      },
    ]);

    const stats = {
      totalUsers,
      activeUsers,
      totalExams,
      totalQuestions,
      completedExams,
      averageScore: resultStats[0] ? Math.round(resultStats[0].avgScore * 10) / 10 : 0,
      averageAccuracy: resultStats[0] ? Math.round(resultStats[0].avgAccuracy * 10) / 10 : 0,
      averageTimeTaken: resultStats[0] ? Math.round(resultStats[0].avgTimeTaken) : 0,
    };

    // Calculate daily exam submissions over the last 7 days for trend graph
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const submissionsTrend = await Result.aggregate([
      { $match: { submittedAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$submittedAt" } },
          count: { $sum: 1 },
          avgScore: { $avg: "$score" },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    // Format trend data
    const trendData = submissionsTrend.map((t) => ({
      date: t._id,
      submissions: t.count,
      avgScore: Math.round(t.avgScore * 10) / 10,
    }));

    const recentExams = await Exam.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .populate("createdBy", "name email");

    const recentUsers = await User.find({ role: "student" })
      .select("-password")
      .sort({ createdAt: -1 })
      .limit(5);

    const recentUploads = await ExtractionReport.find({})
      .sort({ createdAt: -1 })
      .limit(5);

    return res.json({ stats, trendData, recentExams, recentUsers, recentUploads });
  } catch (error) {
    console.error("GET dashboard stats error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET: List all students
router.get("/users", requireAuth(["super_admin", "admin"], "manage_users"), async (req, res) => {
  try {
    await dbConnect();
    const users = await User.find({ role: "student" }).select("-password").sort({ createdAt: -1 });
    return res.json({ users });
  } catch (error) {
    console.error("GET students error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Create a single student
router.post("/users", requireAuth(["super_admin", "admin"], "manage_users"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { name, email, phone, batch } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required." });
    }

    // Check if email already exists
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.status(400).json({ error: "Email is already in use." });
    }

    // Generate credentials
    const rawPassword = Math.random().toString(36).slice(-8) + "Z1!";
    const hashedPassword = await hashPassword(rawPassword);

    const newStudent = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: "student",
      batch: batch || "General",
      status: "active",
      xp: 0,
      streak: 0,
      level: "Intern",
      achievements: [],
      needsPasswordReset: true,
    });

    // Send credentials via Brevo SMTP mail helper
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const loginUrl = `${appUrl}/login?logout=true`;
    
    const emailResult = await sendStudentWelcomeEmail({
      name,
      email: email.toLowerCase(),
      password: rawPassword,
      loginUrl,
    });

    console.log("Student welcome email send result:", emailResult);

    // Audit log
    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "STUDENT_CREATED",
      details: `Created student ${name} (${email}) in batch ${batch || "General"}. Email sent: ${emailResult.success}`,
    });

    const studentObj = newStudent.toObject();
    delete studentObj.password;

    return res.json({
      message: emailResult.success
        ? "Student created successfully."
        : `Student created successfully, but welcome email failed: ${emailResult.error || "Unknown error"}`,
      user: studentObj,
      emailSent: emailResult.success,
      emailError: emailResult.error || null,
    });
  } catch (error) {
    console.error("POST student error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Bulk import students
router.post("/users/bulk", requireAuth(["super_admin", "admin"], "manage_users"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { users } = req.body; // Array of { name, email, phone, batch }

    if (!users || !Array.isArray(users) || users.length === 0) {
      return res.status(400).json({ error: "Invalid or empty users array." });
    }

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const failures = [];

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const loginUrl = `${appUrl}/login`;

    for (const item of users) {
      const { name, email, phone, batch } = item;
      
      if (!name || !email) {
        errorCount++;
        failures.push({ email: email || "unknown", reason: "Missing name or email" });
        continue;
      }

      try {
        const cleanEmail = email.toLowerCase().trim();
        
        // Check duplicate
        const existing = await User.findOne({ email: cleanEmail });
        if (existing) {
          duplicateCount++;
          failures.push({ email: cleanEmail, reason: "Email already in use" });
          continue;
        }

        // Generate credentials
        const rawPassword = Math.random().toString(36).slice(-8) + "Z1!";
        const hashedPassword = await hashPassword(rawPassword);

        await User.create({
          name: name.trim(),
          email: cleanEmail,
          phone: phone ? phone.toString().trim() : "",
          password: hashedPassword,
          role: "student",
          batch: batch ? batch.toString().trim() : "General",
          status: "active",
          needsPasswordReset: true,
        });

        // Trigger welcome email asynchronously
        sendStudentWelcomeEmail({
          name: name.trim(),
          email: cleanEmail,
          password: rawPassword,
          loginUrl,
        }).catch(err => console.error(`Failed to send email to ${cleanEmail}:`, err));

        successCount++;
      } catch (err) {
        errorCount++;
        failures.push({ email: email || "unknown", reason: err.message });
      }
    }

    // Write audit log
    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "BULK_STUDENTS_CREATED",
      details: `Bulk created students: ${successCount} successful, ${duplicateCount} duplicates, ${errorCount} errors.`,
    });

    return res.json({
      message: `Bulk creation process finished.`,
      summary: {
        total: users.length,
        created: successCount,
        duplicates: duplicateCount,
        errors: errorCount,
      },
      failures,
    });
  } catch (error) {
    console.error("POST bulk students error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH: Update student status, batch, or reset password
router.patch("/users/:id", requireAuth(["super_admin", "admin"], "manage_users"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { id } = req.params;
    const { batch, status, resetPassword } = req.body;

    const student = await User.findOne({ _id: id, role: "student" });
    if (!student) {
      return res.status(404).json({ error: "Student not found." });
    }

    let logDetails = [];

    if (batch !== undefined) {
      student.batch = batch;
      logDetails.push(`batch changed to ${batch}`);
    }

    if (status !== undefined) {
      student.status = status;
      logDetails.push(`status changed to ${status}`);
    }

    let passwordResetSuccess = false;
    let newRawPassword = "";
    if (resetPassword) {
      newRawPassword = Math.random().toString(36).slice(-8) + "Z1!";
      student.password = await hashPassword(newRawPassword);
      student.needsPasswordReset = true;
      passwordResetSuccess = true;
      logDetails.push("password reset");
    }

    await student.save();

    // Send email on password reset
    let emailResult = { success: true };
    if (passwordResetSuccess) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      emailResult = await sendPasswordResetEmail({
        name: student.name,
        email: student.email,
        password: newRawPassword,
        loginUrl: `${appUrl}/login?logout=true`
      });
    }

    // Write log
    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "STUDENT_UPDATED",
      details: `Updated student ${student.name} (${student.email}): ${logDetails.join(", ")}. Email sent: ${emailResult.success}`,
    });

    const studentObj = student.toObject();
    delete studentObj.password;

    return res.json({
      message: emailResult.success
        ? "Student updated successfully."
        : `Student updated successfully, but password reset email failed. NEW TEMPORARY PASSWORD: ${newRawPassword}. Error: ${emailResult.error || "Unknown error"}`,
      user: studentObj,
    });
  } catch (error) {
    console.error("PATCH student error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE: Delete student account
router.delete("/users/:id", requireAuth(["super_admin", "admin"], "manage_users"), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { id } = req.params;

    const student = await User.findOneAndDelete({ _id: id, role: "student" });
    if (!student) {
      return res.status(404).json({ error: "Student not found." });
    }

    // Audit log
    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "STUDENT_DELETED",
      details: `Permanently deleted student account ${student.name} (${student.email}).`,
    });

    return res.json({
      message: "Student deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE student error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
