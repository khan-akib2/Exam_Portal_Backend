import express from "express";
import dbConnect from "../lib/db.js";
import User from "../lib/models/User.js";
import ActivityLog from "../lib/models/ActivityLog.js";
import SystemSetting from "../lib/models/SystemSetting.js";
import { requireAuth, hashPassword } from "../lib/auth.js";
import { sendAdminWelcomeEmail, sendEmail, sendPasswordResetEmail } from "../lib/brevo.js";

const router = express.Router();

// GET: List all Sub-Admins
router.get("/admins", requireAuth(["super_admin"]), async (req, res) => {
  try {
    await dbConnect();
    const admins = await User.find({ role: "admin" }).select("-password").sort({ createdAt: -1 });
    return res.json({ admins });
  } catch (error) {
    console.error("GET admins error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Create a new Sub-Admin
router.post("/admins", requireAuth(["super_admin"]), async (req, res) => {
  try {
    await dbConnect();
    const superAdmin = req.user;
    
    const { name, email, phone, permissions } = req.body;

    if (!name || !email) {
      return res.status(400).json({ error: "Name and email are required" });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "Email is already in use" });
    }

    // Generate secure random password
    const rawPassword = Math.random().toString(36).slice(-10) + "A1!";
    const hashedPassword = await hashPassword(rawPassword);

    const newAdmin = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: hashedPassword,
      role: "admin",
      permissions: permissions || [],
      status: "active",
      needsPasswordReset: true,
    });

    // Send credentials and permission list via Brevo email helper
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const loginUrl = `${appUrl}/login?logout=true`;
    
    const emailResult = await sendAdminWelcomeEmail({
      name,
      email,
      password: rawPassword,
      loginUrl,
      permissions: permissions || [],
    });

    console.log("Admin welcome email send result:", emailResult);

    // Write audit log
    await ActivityLog.create({
      user: superAdmin._id,
      userEmail: superAdmin.email,
      action: "SUBADMIN_CREATED",
      details: `Created Sub-Admin ${name} (${email}) with permissions: ${(permissions || []).join(", ")}. Email sent: ${emailResult.success}`,
    });

    // Remove password from returned data
    const adminObj = newAdmin.toObject();
    delete adminObj.password;

    return res.json({
      message: emailResult.success
        ? "Admin created successfully and welcome email sent."
        : `Admin created successfully, but welcome email failed. TEMPORARY PASSWORD: ${rawPassword}. Error: ${emailResult.error || "Unknown error"}`,
      admin: adminObj,
      emailSent: emailResult.success,
      emailError: emailResult.error || null,
    });
  } catch (error) {
    console.error("POST admin error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH: Update admin permissions, status, or reset password
router.patch("/admins/:id", requireAuth(["super_admin"]), async (req, res) => {
  try {
    await dbConnect();
    const superAdmin = req.user;
    const { id } = req.params;
    const { permissions, status, resetPassword } = req.body;

    const admin = await User.findOne({ _id: id, role: "admin" });
    if (!admin) {
      return res.status(404).json({ error: "Sub-Admin not found" });
    }

    let logDetails = [];

    // 1. Update Permissions
    if (permissions !== undefined) {
      admin.permissions = permissions;
      logDetails.push(`updated permissions to: [${permissions.join(", ")}]`);
    }

    // 2. Update Status (active/suspended)
    if (status !== undefined) {
      admin.status = status;
      logDetails.push(`updated status to: ${status}`);
    }

    // 3. Reset Password
    let passwordResetSuccess = false;
    let newRawPassword = "";
    if (resetPassword) {
      newRawPassword = Math.random().toString(36).slice(-10) + "A1!";
      admin.password = await hashPassword(newRawPassword);
      admin.needsPasswordReset = true;
      passwordResetSuccess = true;
      logDetails.push("reset password");
    }

    await admin.save();

    // Send email on password reset
    let emailResult = { success: true };
    if (passwordResetSuccess) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
      emailResult = await sendPasswordResetEmail({
        name: admin.name,
        email: admin.email,
        password: newRawPassword,
        loginUrl: `${appUrl}/login?logout=true`
      });
    }

    // Write audit log
    await ActivityLog.create({
      user: superAdmin._id,
      userEmail: superAdmin.email,
      action: "SUBADMIN_UPDATED",
      details: `Updated Sub-Admin ${admin.name} (${admin.email}): ${logDetails.join(", ")}. Email sent: ${emailResult.success}`,
    });

    const adminObj = admin.toObject();
    delete adminObj.password;

    return res.json({
      message: emailResult.success
        ? "Sub-Admin updated successfully."
        : `Sub-Admin updated successfully, but password reset email failed. NEW TEMPORARY PASSWORD: ${newRawPassword}. Error: ${emailResult.error || "Unknown error"}`,
      admin: adminObj,
    });
  } catch (error) {
    console.error("PATCH admin error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// DELETE: Permanent deletion of a Sub-Admin
router.delete("/admins/:id", requireAuth(["super_admin"]), async (req, res) => {
  try {
    await dbConnect();
    const superAdmin = req.user;
    const { id } = req.params;

    const admin = await User.findOneAndDelete({ _id: id, role: "admin" });
    if (!admin) {
      return res.status(404).json({ error: "Sub-Admin not found" });
    }

    // Write audit log
    await ActivityLog.create({
      user: superAdmin._id,
      userEmail: superAdmin.email,
      action: "SUBADMIN_DELETED",
      details: `Permanently deleted Sub-Admin ${admin.name} (${admin.email}).`,
    });

    return res.json({
      message: "Sub-Admin deleted successfully.",
    });
  } catch (error) {
    console.error("DELETE admin error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET: Fetch system activity audit logs
router.get("/audit-logs", requireAuth(["super_admin"]), async (req, res) => {
  try {
    await dbConnect();
    const logs = await ActivityLog.find({})
      .populate("user", "name role")
      .sort({ timestamp: -1 })
      .limit(100);

    return res.json({ logs });
  } catch (error) {
    console.error("GET audit logs error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// GET: Fetch global system settings
router.get("/settings", requireAuth(["super_admin", "admin"]), async (req, res) => {
  try {
    await dbConnect();
    let settings = await SystemSetting.findOne({ key: "global_config" });
    if (!settings) {
      settings = await SystemSetting.create({
        key: "global_config",
        maintenanceMode: false,
        antiCheatEnabled: true,
        xpPerCorrectAnswer: 10,
        xpPerWrongAnswer: 0,
        streakBonusXp: 20,
      });
    }
    return res.json({ settings });
  } catch (error) {
    console.error("GET settings error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// PATCH: Update global system settings
router.patch("/settings", requireAuth(["super_admin"]), async (req, res) => {
  try {
    await dbConnect();
    const superAdmin = req.user;
    const { maintenanceMode, antiCheatEnabled, xpPerCorrectAnswer, streakBonusXp } = req.body;

    let settings = await SystemSetting.findOne({ key: "global_config" });
    if (!settings) {
      settings = new SystemSetting({ key: "global_config" });
    }

    if (maintenanceMode !== undefined) settings.maintenanceMode = maintenanceMode;
    if (antiCheatEnabled !== undefined) settings.antiCheatEnabled = antiCheatEnabled;
    if (xpPerCorrectAnswer !== undefined) settings.xpPerCorrectAnswer = xpPerCorrectAnswer;
    if (streakBonusXp !== undefined) settings.streakBonusXp = streakBonusXp;

    settings.updatedBy = superAdmin._id;
    settings.updatedAt = new Date();
    await settings.save();

    // Log this action
    await ActivityLog.create({
      user: superAdmin._id,
      userEmail: superAdmin.email,
      action: "SETTINGS_UPDATED",
      details: `Updated platform settings: Maintenance=${settings.maintenanceMode}, AntiCheat=${settings.antiCheatEnabled}, XP/Correct=${settings.xpPerCorrectAnswer}, StreakBonus=${settings.streakBonusXp}.`,
    });

    return res.json({
      message: "System settings updated successfully.",
      settings,
    });
  } catch (error) {
    console.error("PATCH settings error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
