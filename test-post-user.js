import "dotenv/config";
import dbConnect from "./lib/db.js";
import User from "./lib/models/User.js";
import { hashPassword } from "./lib/auth.js";
import { sendStudentWelcomeEmail } from "./lib/brevo.js";

async function main() {
  console.log("1. Connecting to DB...");
  await dbConnect();
  console.log("DB connected successfully.");

  const email = "obaidullahshaikh07@gmail.com";
  const name = "Ubaid";
  const phone = "+919920136318";
  const batch = "Low Class";

  console.log("2. Checking existing user...");
  const existing = await User.findOne({ email: email.toLowerCase() });
  console.log("Existing user found:", existing ? existing.email : "none");

  if (existing) {
    console.log("User already exists. Deleting user to retry creation...");
    await User.deleteOne({ email: email.toLowerCase() });
    console.log("Deleted old user record.");
  }

  console.log("3. Generating password...");
  const rawPassword = Math.random().toString(36).slice(-8) + "Z1!";
  console.log("Raw Password:", rawPassword);
  const hashedPassword = await hashPassword(rawPassword);
  console.log("Hashed Password:", hashedPassword);

  console.log("4. Creating student in DB...");
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
  console.log("Student created successfully in DB:", newStudent._id);

  console.log("5. Sending welcome email...");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const loginUrl = `${appUrl}/login?logout=true`;

  const emailResult = await sendStudentWelcomeEmail({
    name,
    email: email.toLowerCase(),
    password: rawPassword,
    loginUrl,
  });

  console.log("Welcome email result:", emailResult);
}

main().catch((err) => {
  console.error("CRITICAL EXCEPTION RUNNING WORKFLOW:");
  console.error(err);
});
