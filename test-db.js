import "dotenv/config";
import dbConnect from "./lib/db.js";

async function test() {
  try {
    await dbConnect();
    console.log("DB connected successfully");
    process.exit(0);
  } catch (err) {
    console.error("DB connection failed:", err);
    process.exit(1);
  }
}
test();
