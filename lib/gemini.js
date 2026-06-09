import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI = null;

function getGenAI() {
  if (genAI) return genAI;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not defined in environment variables. AI fallback disabled.");
    return null;
  }
  genAI = new GoogleGenerativeAI(apiKey);
  return genAI;
}

let aiMutex = Promise.resolve();

/**
 * Solve a medical MCQ using Gemini 1.5 Flash.
 * @param {string} question - Question text
 * @param {string[]} options - MCQ options array
 * @returns {Promise<{correctAnswer: number, explanation: string} | null>}
 */
export async function solveQuestionWithAI(question, options, retries = 3, delayMs = 15000) {
  const ai = getGenAI();
  if (!ai) return null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await new Promise((resolve, reject) => {
        aiMutex = aiMutex.then(async () => {
          try {
            const model = ai.getGenerativeModel({ model: "gemini-flash-lite-latest" });
            const formattedOptions = options
              .map((opt, i) => `${i}) ${opt || "(Empty)"}`)
              .join("\n");

            const prompt = `You are a clinical medicine education expert. Solve the following medical multiple-choice question.
Determine the correct option index (0-indexed: 0 for A, 1 for B, 2 for C, 3 for D) and write a clear, high-yield diagnostic explanation.

Question:
${question}

Options:
${formattedOptions}

Respond strictly in the following JSON format:
{
  "correctAnswer": 1,
  "explanation": "..."
}`;

            const result = await model.generateContent({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: {
                responseMimeType: "application/json",
              },
            });

            const responseText = result.response.text();
            const data = JSON.parse(responseText);

            if (
              data &&
              typeof data.correctAnswer === "number" &&
              data.correctAnswer >= 0 &&
              data.correctAnswer < options.length
            ) {
              resolve({
                correctAnswer: data.correctAnswer,
                explanation: data.explanation || "Resolved by medical AI expert.",
              });
            } else {
              resolve(null);
            }
          } catch (error) {
            reject(error);
          } finally {
            // Enforce a 4-second gap between requests to respect the 15 RPM limit
            await new Promise(r => setTimeout(r, 4000));
          }
        });
      });
    } catch (error) {
      if (error.status === 429 && attempt < retries) {
        const jitter = Math.floor(Math.random() * 5000);
        const totalDelay = delayMs + jitter;
        console.warn(`Gemini 429 Rate Limit hit. Retrying attempt ${attempt + 1}/${retries} in ${totalDelay/1000}s...`);
        await new Promise((res) => setTimeout(res, totalDelay));
        delayMs *= 1.5; // exponential backoff
      } else {
        console.error("Gemini MCQ resolver error:", error.message || error);
        return null;
      }
    }
  }
  return null;
}
