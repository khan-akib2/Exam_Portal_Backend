import express from "express";
import dbConnect from "../lib/db.js";
import User from "../lib/models/User.js";
import Question from "../lib/models/Question.js";
import Achievement from "../lib/models/Achievement.js";
import SystemSetting from "../lib/models/SystemSetting.js";
import ActivityLog from "../lib/models/ActivityLog.js";
import { comparePassword, signToken, hashPassword, requireAuth } from "../lib/auth.js";
import bcrypt from "bcryptjs";

const router = express.Router();

// POST: Login user
router.post("/login", async (req, res) => {
  try {
    await dbConnect();
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Check status
    if (user.status === "suspended") {
      return res.status(403).json({ error: "Your account has been suspended. Contact support." });
    }

    // Verify password
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    // Sign Token
    const token = signToken(user);

    // Update lastActive if student
    if (user.role === "student") {
      user.lastActive = new Date();
      await user.save();
    }

    // Create Audit Log
    await ActivityLog.create({
      user: user._id,
      userEmail: user.email,
      action: "LOGIN",
      details: `${user.name} logged in successfully as ${user.role}.`,
    });

    // Set token cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days (ms)
      path: "/",
    });

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions || [],
        batch: user.batch,
        xp: user.xp,
        streak: user.streak,
        level: user.level,
        achievements: user.achievements,
        needsPasswordReset: user.needsPasswordReset || false,
      },
    });
  } catch (error) {
    console.error("Login API error:", error);
    return res.status(500).json({ error: "An internal server error occurred." });
  }
});

// GET: Get current session user
router.get("/me", requireAuth(), async (req, res) => {
  try {
    const user = req.user;
    // Sign a fresh token on every verification/refresh
    const token = signToken(user);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days (ms)
      path: "/",
    });

    return res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        permissions: user.permissions || [],
        status: user.status,
        batch: user.batch,
        xp: user.xp,
        streak: user.streak,
        level: user.level,
        achievements: user.achievements,
        needsPasswordReset: user.needsPasswordReset || false,
      },
    });
  } catch (error) {
    console.error("Auth Me API error:", error);
    return res.status(500).json({ error: "An internal server error occurred." });
  }
});

// PATCH: Update current profile
router.patch("/me", requireAuth(), async (req, res) => {
  try {
    const user = req.user;
    
    // Fetch the full User document
    const userDoc = await User.findById(user._id);
    if (!userDoc) {
      return res.status(404).json({ error: "User not found." });
    }

    const { name, phone, currentPassword, newPassword } = req.body;

    if (name !== undefined) {
      if (!name.trim()) {
        return res.status(400).json({ error: "Name cannot be empty." });
      }
      userDoc.name = name.trim();
    }

    if (phone !== undefined) {
      userDoc.phone = phone.trim();
    }

    if (newPassword) {
      // If the user does not need a mandatory password reset, verify their current password first
      if (!userDoc.needsPasswordReset) {
        if (!currentPassword) {
          return res.status(400).json({ error: "Current password is required to change password." });
        }
        
        const isMatch = await bcrypt.compare(currentPassword, userDoc.password);
        if (!isMatch) {
          return res.status(400).json({ error: "Incorrect current password." });
        }
      }

      if (newPassword.length < 6) {
        return res.status(400).json({ error: "New password must be at least 6 characters long." });
      }

      const salt = await bcrypt.genSalt(10);
      userDoc.password = await bcrypt.hash(newPassword, salt);
      userDoc.needsPasswordReset = false;
    }

    await userDoc.save();

    // Sign a fresh token on update
    const token = signToken(userDoc);

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days (ms)
      path: "/",
    });

    return res.json({
      message: "Profile updated successfully.",
      token,
      user: {
        id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        role: userDoc.role,
        permissions: userDoc.permissions || [],
        status: userDoc.status,
        batch: userDoc.batch,
        xp: userDoc.xp,
        streak: userDoc.streak,
        level: userDoc.level,
        achievements: userDoc.achievements,
        needsPasswordReset: userDoc.needsPasswordReset || false,
      },
    });
  } catch (error) {
    console.error("PATCH Auth Me error:", error);
    return res.status(500).json({ error: "Server error: " + error.message });
  }
});

export default router;
