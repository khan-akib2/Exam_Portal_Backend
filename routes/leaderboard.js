import express from "express";
import dbConnect from "../lib/db.js";
import User from "../lib/models/User.js";
import { requireAuth } from "../lib/auth.js";

const router = express.Router();

// GET: Retrieve leaderboard listing
router.get("/", requireAuth(), async (req, res) => {
  try {
    await dbConnect();
    // Get all students by XP
    const leaderboard = await User.find({ role: "student" })
      .select("name xp level streak batch")
      .sort({ xp: -1 });

    return res.json({
      leaderboard,
    });
  } catch (error) {
    console.error("GET leaderboard error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
