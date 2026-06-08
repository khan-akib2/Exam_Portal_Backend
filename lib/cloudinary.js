import { v2 as cloudinary } from "cloudinary";
import fs from "fs";
import path from "path";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const isConfigured = cloudName && apiKey && apiSecret;

if (isConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
  });
}

/**
 * Uploads an image to Cloudinary.
 * Falls back to saving the image locally in /public/uploads/ if credentials are not configured.
 * @param {string} fileBase64 - Base64 encoded file string (e.g. data:image/png;base64,...)
 * @param {string} fileName - Suggested file name
 * @returns {Promise<string>} - The URL of the uploaded image
 */
export async function uploadImage(fileBase64, fileName = "image") {
  if (isConfigured) {
    try {
      const uploadRes = await cloudinary.uploader.upload(fileBase64, {
        folder: "medical-exam-portal",
        resource_type: "auto",
      });
      return uploadRes.secure_url;
    } catch (error) {
      console.error("Cloudinary upload failed, falling back to local storage:", error);
    }
  }

  // Local storage fallback (very useful for offline testing and development)
  try {
    const cleanBase64 = fileBase64.replace(/^data:image\/\w+;base64,/, "");
    const buffer = Buffer.from(cleanBase64, "base64");
    
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }

    const fileExt = fileBase64.substring("data:image/".length, fileBase64.indexOf(";base64")) || "png";
    const baseName = fileName.replace(/\s+/g, "_");
    const uniqueFileName = baseName === "image" ? `image_${Date.now()}.${fileExt}` : `${baseName}.${fileExt}`;
    const filePath = path.join(uploadDir, uniqueFileName);
    
    fs.writeFileSync(filePath, buffer);
    console.log(`Saved image locally fallback: /uploads/${uniqueFileName}`);
    return `/uploads/${uniqueFileName}`;
  } catch (err) {
    console.error("Local file save fallback failed:", err);
    throw new Error("Failed to upload image: " + err.message);
  }
}
