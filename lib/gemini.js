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

/**
 * Solve a medical MCQ using Gemini 1.5 Flash.
 * @param {string} question - Question text
 * @param {string[]} options - MCQ options array
 * @returns {Promise<{correctAnswer: number, explanation: string} | null>}
 */
export async function solveQuestionWithAI(question, options) {
  const ai = getGenAI();
  if (!ai) return null;

  try {
    const model = ai.getGenerativeModel({ model: "gemini-1.5-flash" });
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
      return {
        correctAnswer: data.correctAnswer,
        explanation: data.explanation || "Resolved by medical AI expert.",
      };
    }
    return null;
  } catch (error) {
    console.error("Gemini MCQ resolver error:", error);
    return null;
  }
}
