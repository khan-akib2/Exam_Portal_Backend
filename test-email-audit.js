import "dotenv/config";
import { sendStudentWelcomeEmail } from "./lib/brevo.js";

async function main() {
  console.log("--- Starting Email Delivery Audit Test ---");
  const result = await sendStudentWelcomeEmail({
    name: "Audit Test User",
    email: "ramzankhan4212@gmail.com", // You can change this to your email to verify
    password: "TestPassword123!",
    loginUrl: "http://localhost:3000/login",
  });
  console.log("--- Audit Test Complete ---");
  console.log("Result:", result);
}

main();
