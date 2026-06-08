import express from "express";
import dbConnect from "../lib/db.js";
import Notification from "../lib/models/Notification.js";
import User from "../lib/models/User.js";
import ActivityLog from "../lib/models/ActivityLog.js";
import { requireAuth } from "../lib/auth.js";
import { sendEmail } from "../lib/brevo.js";

const router = express.Router();

// GET: Fetch announcements
router.get("/", requireAuth(), async (req, res) => {
  try {
    await dbConnect();
    const user = req.user;

    let query = {};
    if (user.role === "student") {
      // Students only see announcements matching their batch or "All"
      query = {
        $or: [{ targetBatch: "All" }, { targetBatch: user.batch }],
      };
    }

    const notifications = await Notification.find(query)
      .populate("sentBy", "name role")
      .sort({ createdAt: -1 });

    return res.json({ notifications });
  } catch (error) {
    console.error("GET notifications error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

// POST: Create a notification and broadcast it
router.post("/", requireAuth(["super_admin", "admin"]), async (req, res) => {
  try {
    await dbConnect();
    const adminUser = req.user;
    const { title, content, type, targetBatch, sendAsEmail } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required." });
    }

    const notification = await Notification.create({
      title,
      content,
      type: type || "general",
      targetBatch: targetBatch || "All",
      sentBy: adminUser._id,
    });

    // Handle Email Broadcast in Background
    if (sendAsEmail) {
      const query = { role: "student", status: "active" };
      if (targetBatch && targetBatch !== "All") {
        query.batch = targetBatch;
      }

      const usersToEmail = await User.find(query).select("email name");
      
      console.log(`Broadcasting email to ${usersToEmail.length} students in batch ${targetBatch || "All"}`);

      // Async email broadcast
      (async () => {
        for (const recipient of usersToEmail) {
          try {
            await sendEmail({
              to: recipient.email,
              subject: `Announcement: ${title}`,
              text: `Hello ${recipient.name},\n\nA new announcement has been posted on the Medical Portal:\n\n${content}\n\nBest regards,\nMedical Assessment Team`,
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
                  <h2 style="color: #0f766e; text-align: center; border-bottom: 2px solid #0f766e; padding-bottom: 10px;">New Platform Announcement</h2>
                  <p>Hello <strong>${recipient.name}</strong>,</p>
                  <p>An administrator has published a new announcement:</p>
                  <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 15px; margin: 20px 0; border-radius: 4px;">
                    <h3 style="margin: 0 0 10px 0; color: #15803d;">${title}</h3>
                    <p style="margin: 0; line-height: 1.6; color: #374151;">${content}</p>
                  </div>
                  <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 20px 0;" />
                  <p style="font-size: 12px; color: #9ca3af; text-align: center;">You received this because you are registered as a student in batch: ${recipient.batch || "General"}.</p>
                </div>
              `
            });
          } catch (emailErr) {
            console.error(`Broadcast email failed for ${recipient.email}:`, emailErr);
          }
        }
      })();
    }

    // Write audit log
    await ActivityLog.create({
      user: adminUser._id,
      userEmail: adminUser.email,
      action: "NOTIFICATION_BROADCAST",
      details: `Created announcement "${title}" for batch ${targetBatch || "All"}. Email broadcast: ${sendAsEmail ? "Yes" : "No"}.`,
    });

    return res.json({
      message: "Announcement created successfully.",
      notification,
    });
  } catch (error) {
    console.error("POST notification error:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

export default router;
