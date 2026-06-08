import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import dbConnect from "./lib/db.js";
import { rateLimiter } from "./lib/rateLimiter.js";

// Import routers
import authRouter from "./routes/auth.js";
import superadminRouter from "./routes/superadmin.js";
import adminRouter from "./routes/admin.js";
import examsRouter from "./routes/exams.js";
import questionsRouter from "./routes/questions.js";
import attemptsRouter from "./routes/attempts.js";
import analyticsRouter from "./routes/analytics.js";
import leaderboardRouter from "./routes/leaderboard.js";
import notificationsRouter from "./routes/notifications.js";

const app = express();

// Configure CORS (matching frontend origin)
app.use(
  cors({
    origin: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    credentials: true,
  })
);

// Standard parsers
app.use(express.json({ limit: "50mb" })); // Increased limit to support base64 question images
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(cookieParser());

// Rate Limiting Middlewares
app.use("/api/auth/login", rateLimiter(25));
app.use("/api/questions/upload-pdf", rateLimiter(10));
app.use("/api", rateLimiter(200));

// Mount routers under /api prefix
app.use("/api/auth", authRouter);
app.use("/api/superadmin", superadminRouter);
app.use("/api/admin", adminRouter);
app.use("/api/exams", examsRouter);
app.use("/api/questions", questionsRouter);
app.use("/api/attempts", attemptsRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/leaderboard", leaderboardRouter);
app.use("/api/notifications", notificationsRouter);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "OK", timestamp: new Date() });
});

// Port configuration
const PORT = process.env.PORT || 5000;

// Connect to database and start server
dbConnect()
  .then(() => {
    console.log("Database connected and auto-seeding completed.");
    app.listen(PORT, () => {
      console.log(`Express server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection failed:", err);
    process.exit(1);
  });
