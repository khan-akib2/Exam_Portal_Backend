import modulePkg from "module";
import { uploadImage } from "./cloudinary.js";
import { createWorker } from "tesseract.js";
import { solveQuestionWithAI } from "./gemini.js";
import path from "path";

let isInitialized = false;
let pdfParse = null;
let loadImage = null;
let createCanvas = null;

async function initializeParser() {
  if (isInitialized) return;

  const nativeRequire = modulePkg["createRequire"](import.meta.url);

  // Resolve the exact `@napi-rs/canvas` package that `pdf-parse` uses to avoid duplicate module instantiation
  let canvasPkg;
  try {
    const getNestedCanvasPath = () => {
      const base = process.cwd();
      const segments = ["node_modules", "pdf-parse", "node_modules", "@napi-rs", "canvas", "index.js"];
      return path.join(base, ...segments);
    };
    canvasPkg = nativeRequire(getNestedCanvasPath());
    console.log("Successfully resolved nested @napi-rs/canvas package used by pdf-parse.");
  } catch (e) {
    console.warn("Failed to resolve nested @napi-rs/canvas package, falling back to root resolution.", e);
    canvasPkg = nativeRequire("@napi-rs/canvas");
  }

  const { DOMMatrix, ImageData, Path2D } = canvasPkg;
  loadImage = canvasPkg.loadImage;
  createCanvas = canvasPkg.createCanvas;

  // Polyfill browser globals for pdf-parse under Node/Next.js server environments
  global.DOMMatrix = DOMMatrix;
  global.ImageData = ImageData;
  global.Path2D = Path2D;

  pdfParse = nativeRequire("pdf-parse");
  isInitialized = true;
}

// Matrix helper utilities for PDF vector coordinates parsing
function multiplyMatrix(m1, m2) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
}

function transformPoint(p, m) {
  const x = p[0];
  const y = p[1];
  return [
    x * m[0] + y * m[2] + m[4],
    x * m[1] + y * m[3] + m[5]
  ];
}

// Extracted Vector Highlight Detector (Layer 3)
async function extractHighlightsFromOpList(opList) {
  const OPS = {
    save: 10,
    restore: 11,
    transform: 12,
    moveTo: 13,
    lineTo: 14,
    curveTo: 15,
    closePath: 18,
    rectangle: 19,
    stroke: 21,
    fill: 22,
    eoFill: 23,
    fillStroke: 24,
    eoFillStroke: 25,
    setFillColor: 54,
    setFillColorN: 55,
    setFillGray: 57,
    setFillRGBColor: 59,
    setFillCMYKColor: 61,
    constructPath: 91
  };

  let ctm = [1, 0, 0, 1, 0, 0];
  const ctmStack = [];
  
  let currentFillColor = [0, 0, 0];
  let currentPathPoints = [];
  const highlights = [];
  const underlines = [];

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i];
    const args = opList.argsArray[i];

    if (op === OPS.save) {
      ctmStack.push([...ctm]);
    } else if (op === OPS.restore) {
      if (ctmStack.length > 0) {
        ctm = ctmStack.pop();
      }
    } else if (op === OPS.transform) {
      ctm = multiplyMatrix(args, ctm);
    } else if (op === OPS.setFillRGBColor) {
      currentFillColor = args;
    } else if (op === OPS.setFillColor || op === OPS.setFillColorN) {
      if (args && args.length >= 3) {
        currentFillColor = args.slice(0, 3);
      } else if (args && args.length === 1) {
        currentFillColor = [args[0], args[0], args[0]];
      }
    } else if (op === OPS.setFillGray) {
      if (args && args.length >= 1) {
        currentFillColor = [args[0], args[0], args[0]];
      }
    } else if (op === OPS.setFillCMYKColor) {
      if (args && args.length >= 4) {
        const [c, m, y, k] = args;
        const r = (1 - c) * (1 - k);
        const g = (1 - m) * (1 - k);
        const b = (1 - y) * (1 - k);
        currentFillColor = [r, g, b];
      }
    } else if (op === OPS.rectangle) {
      const [x, y, w, h] = args;
      const p1 = transformPoint([x, y], ctm);
      const p2 = transformPoint([x + w, y + h], ctm);
      currentPathPoints.push(p1, p2);
    } else if (op === OPS.constructPath) {
      if (!args || args.length < 2) continue;
      const opCodes = args[0];
      const coords = args[1];
      if (!opCodes || !coords) continue;
      
      let coordIdx = 0;
      for (let j = 0; j < opCodes.length; j++) {
        const code = opCodes[j];
        if (code === 0 || code === 1) { // moveTo, lineTo
          const x = coords[coordIdx++];
          const y = coords[coordIdx++];
          if (x !== undefined && y !== undefined) {
            currentPathPoints.push(transformPoint([x, y], ctm));
          }
        } else if (code === 2) { // curveTo
          const x1 = coords[coordIdx++];
          const y1 = coords[coordIdx++];
          const x2 = coords[coordIdx++];
          const y2 = coords[coordIdx++];
          const x3 = coords[coordIdx++];
          const y3 = coords[coordIdx++];
          if (x3 !== undefined && y3 !== undefined) {
            currentPathPoints.push(
              transformPoint([x1, y1], ctm),
              transformPoint([x2, y2], ctm),
              transformPoint([x3, y3], ctm)
            );
          }
        }
      }
    } else if (
      op === OPS.fill ||
      op === OPS.eoFill ||
      op === OPS.fillStroke ||
      op === OPS.eoFillStroke ||
      op === OPS.stroke
    ) {
      if (currentPathPoints.length > 0) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const p of currentPathPoints) {
          minX = Math.min(minX, p[0]);
          maxX = Math.max(maxX, p[0]);
          minY = Math.min(minY, p[1]);
          maxY = Math.max(maxY, p[1]);
        }

        // 1. Detect Vector Highlights (filled shapes with bright colors)
        if (op !== OPS.stroke) {
          const [r, g, b] = currentFillColor;
          const rVal = r > 1.0 || g > 1.0 || b > 1.0 ? r : r * 255;
          const gVal = r > 1.0 || g > 1.0 || b > 1.0 ? g : g * 255;
          const bVal = r > 1.0 || g > 1.0 || b > 1.0 ? b : b * 255;
          
          const max = Math.max(rVal, gVal, bVal);
          const min = Math.min(rVal, gVal, bVal);
          const isBrightSaturated = (max - min > 35) && ((rVal + gVal + bVal) / 3 > 120);

          if (isBrightSaturated) {
            let colorType = "yellow";
            if (gVal > rVal && gVal > bVal && rVal < 185) {
              colorType = "green";
            } else if (rVal > gVal && bVal > gVal && gVal < 185) {
              colorType = "pink";
            } else if (gVal > rVal && bVal > rVal && rVal < 185) {
              colorType = "cyan";
            } else if (rVal > 190 && gVal > 190 && bVal < 130) {
              colorType = "yellow";
            }

            highlights.push({
              rect: [minX, minY, maxX, maxY],
              color: [rVal, gVal, bVal],
              colorType
            });
          }
        }

        // 2. Detect Vector Underlines (narrow horizontal line paths)
        const isHorizontalLine = (maxY - minY < 5) && (maxX - minX > 8);
        if (isHorizontalLine) {
          underlines.push([minX, minY, maxX, maxY]);
        }
      }
      currentPathPoints = [];
    }
  }

  return { highlights, underlines };
}

// End Answer Key Detector (Layer 4)
async function parseEndOfPdfAnswerKeys(doc) {
  const answersMap = {};
  const numPages = doc.numPages;
  if (numPages < 2) return null;

  const startPage = Math.max(1, numPages - 3);
  let foundKeyCount = 0;

  for (let pageNum = numPages; pageNum >= startPage; pageNum--) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");

    // Matches e.g. "1. A", "1-B", "1 B", "1) C", "1: D"
    const pattern = /\b(\d+)\s*[-.\s\)=:]\s*([A-Ea-e])\b/g;
    const matches = [...text.matchAll(pattern)];

    if (matches.length >= 6) {
      console.log(`Auto-detected answer key page on page ${pageNum} with ${matches.length} matches.`);
      for (const match of matches) {
        const qNum = parseInt(match[1]);
        const ansLetter = match[2].toUpperCase();
        const ansIdx = ansLetter.charCodeAt(0) - 65;
        answersMap[qNum] = ansIdx;
        foundKeyCount++;
      }
    }
  }

  return foundKeyCount >= 6 ? answersMap : null;
}

// Separate Answers PDF Support (Layer 5)
export async function parseSeparateAnswersPdf(answersBuffer) {
  if (!answersBuffer) return null;
  await initializeParser();
  
  let parser;
  try {
    parser = new pdfParse.PDFParse({ data: answersBuffer });
    await parser.getText();
  } catch (err) {
    console.error("Separate answers PDF load failed:", err);
    return null;
  }

  const doc = parser.doc;
  if (!doc) return null;

  const answersMap = {};
  let totalMatches = 0;

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const textContent = await page.getTextContent();
    const text = textContent.items.map(item => item.str).join(" ");

    const pattern = /\b(\d+)\s*[-.\s\)=:]\s*([A-Ea-e])\b/g;
    const matches = [...text.matchAll(pattern)];

    for (const match of matches) {
      const qNum = parseInt(match[1]);
      const ansLetter = match[2].toUpperCase();
      const ansIdx = ansLetter.charCodeAt(0) - 65;
      answersMap[qNum] = ansIdx;
      totalMatches++;
    }
  }

  console.log(`Parsed separate answers PDF. Extracted ${totalMatches} key mappings.`);
  return totalMatches > 0 ? answersMap : null;
}

/**
 * Main parser function to extract MCQs from a PDF file.
 */
export async function parsePdfToQuestions(pdfBuffer, pdfName, template = null, answersBuffer = null) {
  await initializeParser();
  let parser;
  let parsedResult;
  try {
    parser = new pdfParse.PDFParse({ data: pdfBuffer });
    parsedResult = await parser.getText();
  } catch (err) {
    console.error("Local pdf-parse load failed:", err);
    throw new Error("Failed to load PDF structure: " + err.message);
  }

  const doc = parser.doc;
  if (!doc) {
    throw new Error("PDF document object could not be resolved.");
  }

  const numPages = doc.numPages;
  console.log(`Processing PDF "${pdfName}" with ${numPages} pages.`);

  let totalTextLength = 0;
  const pageTexts = [];
  
  if (parsedResult && parsedResult.pages) {
    for (const page of parsedResult.pages) {
      const pageText = page.text || "";
      totalTextLength += pageText.length;
      pageTexts.push(pageText);
    }
  }

  let extractedQuestions = [];

  let result;
  if (totalTextLength < 100) {
    console.log("PDF text content is low. Running Tesseract.js OCR fallback...");
    result = await runOcrPipeline(parser, numPages, pdfName);
  } else {
    console.log("PDF text detected. Running structured layout parser...");
    result = await runStructuredLayoutParser(parser, doc, numPages, pdfName, template, answersBuffer);
  }

  return result;
}

/**
 * Structured PDF Layout Parser
 */
async function runStructuredLayoutParser(parser, doc, numPages, pdfName, template, answersBuffer = null) {
  const allLines = [];

  // Pre-parse end of PDF answers and separate answer sheet (Layers 4 & 5)
  let endAnswersMap = null;
  try {
    endAnswersMap = await parseEndOfPdfAnswerKeys(doc);
  } catch (err) {
    console.warn("Failed to check end answer keys:", err);
  }

  let separateAnswersMap = null;
  if (answersBuffer) {
    try {
      separateAnswersMap = await parseSeparateAnswersPdf(answersBuffer);
    } catch (err) {
      console.warn("Failed to check separate answer file:", err);
    }
  }

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    
    // Get text content
    const textContent = await page.getTextContent({ includeMarkedContent: true });
    
    // Get PDF annotations
    let annotations = [];
    try {
      annotations = await page.getAnnotations();
    } catch (err) {
      console.warn(`Annotations error on page ${pageNum}:`, err);
    }

    // Retrieve vector graphics highlights and underlines (Layer 3)
    let highlights = [];
    let underlines = [];
    try {
      const opList = await page.getOperatorList();
      const extracted = await extractHighlightsFromOpList(opList);
      highlights = extracted.highlights || [];
      underlines = extracted.underlines || [];
    } catch (err) {
      console.warn(`Failed to retrieve operator list on page ${pageNum}:`, err);
    }

    // Group items into lines
    const pageLines = groupItemsIntoLines(textContent, annotations, highlights, underlines).map(line => ({
      ...line,
      pageNum
    }));
    
    allLines.push(...pageLines);
  }

  // Parse questions from all combined lines
  const { questions, skippedCount } = parseQuestionsFromLines(allLines, 1);

  // Attach images to questions page-by-page on-demand to avoid allocating all images at once (RangeError fix)
  const pagesWithQuestions = Array.from(new Set(questions.map(q => q.pageNum)));
  for (const pageNum of pagesWithQuestions) {
    try {
      const pageImagesResult = await parser.getImage({ partial: [pageNum], imageDataUrl: true, imageBuffer: false });
      const pageImages = pageImagesResult?.pages?.[0]?.images || [];
      // Filter out small decorative layout images, icons, and lines (under 120x120 px)
      const validImages = pageImages.filter(img => img.width > 120 && img.height > 120);
      if (validImages.length > 0) {
        const qOnPage = questions.find(q => q.pageNum === pageNum);
        if (qOnPage) {
          const imageUrl = await uploadImage(validImages[0].dataUrl, `${pdfName}_p${pageNum}`);
          qOnPage.image = imageUrl;
        }
      }
    } catch (err) {
      console.warn(`Could not extract embedded images from page ${pageNum}:`, err);
    }
  }

  const evaluatedQuestions = await evaluateCorrectAnswers(questions, pdfName, template, {
    endAnswersMap,
    separateAnswersMap
  });

  return { questions: evaluatedQuestions, skippedCount };
}

function isOverlappingItem(item, rect) {
  const tx = item.transform[4];
  const ty = item.transform[5];
  const width = item.width || 0;
  const height = item.height || 0;

  const itemBox = {
    xMin: tx,
    xMax: tx + width,
    yMin: ty,
    yMax: ty + height
  };

  const [ax1, ay1, ax2, ay2] = rect;
  const aXMin = Math.min(ax1, ax2);
  const aXMax = Math.max(ax1, ax2);
  const aYMin = Math.min(ay1, ay2);
  const aYMax = Math.max(ay1, ay2);

  const overlapX = Math.max(0, Math.min(itemBox.xMax, aXMax) - Math.max(itemBox.xMin, aXMin));
  const overlapY = Math.max(0, Math.min(itemBox.yMax, aYMax) - Math.max(itemBox.yMin, aYMin));
  
  if (overlapX > 0 && overlapY > 0) {
    const overlapArea = overlapX * overlapY;
    const itemArea = (itemBox.xMax - itemBox.xMin) * (itemBox.yMax - itemBox.yMin);
    return itemArea > 0 ? (overlapArea / itemArea) > 0.2 : true;
  }
  
  return false;
}

function isOverlappingUnderline(item, rect) {
  const tx = item.transform[4];
  const ty = item.transform[5];
  const width = item.width || 0;
  const height = item.height || 0;

  const itemBox = {
    xMin: tx,
    xMax: tx + width,
    yMin: ty - 5,
    yMax: ty + height
  };

  const [lx1, ly1, lx2, ly2] = rect;
  const lXMin = Math.min(lx1, lx2);
  const lXMax = Math.max(lx1, lx2);
  const lYMin = Math.min(ly1, ly2);
  const lYMax = Math.max(ly1, ly2);

  const overlapX = Math.max(0, Math.min(itemBox.xMax, lXMax) - Math.max(itemBox.xMin, lXMin));
  const isNearY = lYMin >= ty - 5 && lYMax <= ty + 3;

  if (overlapX > 0 && isNearY) {
    const itemAreaWidth = itemBox.xMax - itemBox.xMin;
    return itemAreaWidth > 0 ? (overlapX / itemAreaWidth) > 0.15 : true;
  }
  return false;
}

function matchOptionLine(text) {
  const regexes = [
    /^\s*\(([A-Ea-e])\)\s*(.+)/,             // Match e.g. "(A) option text"
    /^\s*([A-Ea-e])\s*[\dots\:\)\-]\s*(.+)/,     // Match e.g. "A. option text", "A) option text", "A: option text", "A - option text"
    /^\s*([A-Ea-e])\s+([A-Za-z0-9_].*)/       // Match e.g. "A option text" (space only)
  ];

  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) {
      return {
        letter: match[1].toUpperCase(),
        text: match[2].trim()
      };
    }
  }
  return null;
}

function groupItemsIntoLines(textContent, annotations, highlights = [], underlines = []) {
  const textItems = (textContent.items || []).filter(item => item && item.transform);
  if (textItems.length === 0) return [];

  // Determine split gutter for two column layout
  let minX = Infinity, maxX = -Infinity;
  for (const item of textItems) {
    const x = item.transform[4];
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + item.width);
  }
  const center = (minX + maxX) / 2;

  let bestSplitX = center;
  let minCrossCount = Infinity;
  for (let x = 270; x <= 330; x += 5) {
    let crosses = 0;
    for (const item of textItems) {
      const xStart = item.transform[4];
      const xEnd = xStart + item.width;
      if (xStart < x - 5 && xEnd > x + 5) {
        crosses++;
      }
    }
    if (crosses < minCrossCount) {
      minCrossCount = crosses;
      bestSplitX = x;
    }
  }

  const splitX = bestSplitX;
  let leftItems = [];
  let rightItems = [];
  let crossCount = 0;

  for (const item of textItems) {
    const xStart = item.transform[4];
    const xEnd = xStart + item.width;
    if (xStart < splitX - 5 && xEnd > splitX + 5) {
      crossCount++;
    }
    const midX = xStart + (item.width || 0) / 2;
    if (midX < splitX) {
      leftItems.push(item);
    } else {
      rightItems.push(item);
    }
  }

  const isColumnLayout = leftItems.length > 5 && rightItems.length > 5 && (crossCount / textItems.length < 0.08);
  let sortedLeftItems = [];
  let sortedRightItems = [];
  
  if (isColumnLayout) {
    sortedLeftItems = [...leftItems].sort((a, b) => b.transform[5] - a.transform[5]);
    sortedRightItems = [...rightItems].sort((a, b) => b.transform[5] - a.transform[5]);
  } else {
    sortedLeftItems = [...textItems].sort((a, b) => b.transform[5] - a.transform[5]);
  }

  const groupColumnsToLines = (sortedColumnItems) => {
    const columnLines = [];
    let currentLine = [];

    for (const item of sortedColumnItems) {
      if (currentLine.length === 0) {
        currentLine.push(item);
      } else {
        const prevItem = currentLine[currentLine.length - 1];
        const yDiff = Math.abs(prevItem.transform[5] - item.transform[5]);
        if (yDiff < 4) {
          currentLine.push(item);
        } else {
          currentLine.sort((a, b) => a.transform[4] - b.transform[4]);
          columnLines.push(currentLine);
          currentLine = [item];
        }
      }
    }
    if (currentLine.length > 0) {
      currentLine.sort((a, b) => a.transform[4] - b.transform[4]);
      columnLines.push(currentLine);
    }
    return columnLines;
  };

  const leftLines = groupColumnsToLines(sortedLeftItems);
  const rightLines = groupColumnsToLines(sortedRightItems);
  const lines = [...leftLines, ...rightLines];

  return lines.map(lineItems => {
    let text = "";
    let isBold = false;
    let isHighlighted = false;
    let highlightColor = null;
    let isUnderlined = false;
    const fontNames = new Set();
    let lastXMax = 0;

    for (const item of lineItems) {
      const tx = item.transform[4];
      const width = item.width || 0;

      if (lastXMax > 0 && (tx - lastXMax) > 4) {
        text += " ";
      }
      text += item.str;
      lastXMax = tx + width;

      const styleId = item.fontName;
      fontNames.add(styleId);
      const fontStyle = textContent.styles[styleId];
      const fontFamily = fontStyle?.fontFamily || "";

      if (
        fontFamily.toLowerCase().includes("bold") ||
        fontFamily.toLowerCase().includes("black") ||
        styleId.toLowerCase().includes("bold")
      ) {
        isBold = true;
      }

      // Check annotations
      for (const ann of annotations) {
        if (ann.subtype === "Highlight" && isOverlappingItem(item, ann.rect)) {
          isHighlighted = true;
          highlightColor = "yellow";
        }
        if (ann.subtype === "Underline" && isOverlappingItem(item, ann.rect)) {
          isUnderlined = true;
        }
      }

      // Check vector highlights (yellow/green/etc)
      for (const hl of highlights) {
        if (isOverlappingItem(item, hl.rect)) {
          isHighlighted = true;
          highlightColor = hl.colorType;
        }
      }

      // Check vector underlines
      for (const ul of underlines) {
        if (isOverlappingUnderline(item, ul)) {
          isUnderlined = true;
        }
      }
    }

    return {
      text: text.trim(),
      isBold,
      isHighlighted,
      highlightColor,
      isUnderlined,
      fontNames: Array.from(fontNames),
      y: lineItems[0].transform[5]
    };
  }).filter(l => l.text.length > 0);
}

function splitInlineOptions(text) {
  const delimiters = [
    { regex: /\s+([B-Eb-e])\s*[\dots\:\)\-]\s+/g, start: /^\s*\(?([A-Ea-e])\)?\s*[\dots\:\)\-]\s*(.*)/ },
    { regex: /\s+([B-Eb-e])\s+/g, start: /^\s*([A-Ea-e])\s+(.*)/ }
  ];

  for (const delim of delimiters) {
    const startMatch = text.match(delim.start);
    if (!startMatch) continue;

    const firstLetter = startMatch[1].toUpperCase();
    const restText = startMatch[2] || "";

    const matches = [...restText.matchAll(delim.regex)];
    if (matches.length === 0) {
      continue;
    }

    let currentLetterCode = firstLetter.charCodeAt(0);
    const parts = [];
    let lastIndex = 0;
    let lastLetter = firstLetter;

    for (const m of matches) {
      const nextLetter = m[1].toUpperCase();
      const nextLetterCode = nextLetter.charCodeAt(0);

      if (nextLetterCode === currentLetterCode + 1) {
        const optText = restText.substring(lastIndex, m.index).trim();
        parts.push({ letter: lastLetter, text: optText });
        lastIndex = m.index + m[0].length;
        lastLetter = nextLetter;
        currentLetterCode = nextLetterCode;
      }
    }

    if (parts.length > 0) {
      const finalOptText = restText.substring(lastIndex).trim();
      parts.push({ letter: lastLetter, text: finalOptText });
      return parts;
    }
  }

  return null;
}

/**
 * Parses questions, options, and explanations sequentially (Layer 11)
 */
function parseQuestionsFromLines(pageLines, pageNum) {
  const questions = [];
  let skippedCount = 0;
  let currentQ = null;

  // Generic matching formats (support question numbers past 999)
  const questionRegex = /^(?:Q|q)?\.?\s*(\d+)(?:\s*[\.\:\)]\s*(.+)+|\s+["“'‘]?[A-Z].+)/;

  for (let i = 0; i < pageLines.length; i++) {
    const line = pageLines[i];

    // Check for inline options
    const inlineOptions = splitInlineOptions(line.text);
    if (inlineOptions && inlineOptions.length > 1 && currentQ) {
      for (const opt of inlineOptions) {
        const idx = opt.letter.charCodeAt(0) - 65;
        currentQ.options[idx] = opt.text;
        currentQ.optionMetadata[idx] = {
          isBold: line.isBold,
          isHighlighted: line.isHighlighted,
          highlightColor: line.highlightColor,
          isUnderlined: line.isUnderlined,
          fontNames: line.fontNames,
          text: opt.text
        };
      }
      continue;
    }

    const qMatch = line.text.match(questionRegex);
    if (qMatch) {
      if (currentQ) {
        if (currentQ.options.length >= 2 && currentQ.question && currentQ.question.trim()) {
          questions.push(currentQ);
        } else {
          skippedCount++;
        }
      }
      const qText = (qMatch[2] || qMatch[3] || "").trim();
      currentQ = {
        num: parseInt(qMatch[1]),
        question: qText,
        options: [],
        optionMetadata: [],
        correctAnswer: -1,
        explanation: "",
        subject: "General Medicine",
        difficulty: "Medium",
        tags: [],
        pageNum: line.pageNum || pageNum
      };
      continue;
    }

    // Generic Block Option matching
    let optMatch = null;
    if (currentQ) {
      const match = matchOptionLine(line.text);
      if (match) {
        const idx = match.letter.charCodeAt(0) - 65;
        // Ensure sequential consistency
        if (idx === currentQ.options.length || (idx === 0 && currentQ.options.length === 0)) {
          optMatch = match;
        }
      }
    }

    if (optMatch && currentQ) {
      const idx = optMatch.letter.charCodeAt(0) - 65;
      const optText = optMatch.text;

      currentQ.options[idx] = optText;
      currentQ.optionMetadata[idx] = {
        isBold: line.isBold,
        isHighlighted: line.isHighlighted,
        highlightColor: line.highlightColor,
        isUnderlined: line.isUnderlined,
        fontNames: line.fontNames,
        text: optText
      };
      continue;
    }

    if (currentQ) {
      if (currentQ.options.length === 0) {
        currentQ.question += " " + line.text;
      } else {
        if (
          line.text.toLowerCase().startsWith("explanation:") ||
          line.text.toLowerCase().startsWith("ans:") ||
          line.text.toLowerCase().startsWith("answer:")
        ) {
          currentQ.explanation = line.text.replace(/^(explanation|ans|answer)\s*:\s*/i, "").trim();
        } else if (line.text.toLowerCase().startsWith("subject:")) {
          currentQ.subject = line.text.replace(/^subject\s*:\s*/i, "").trim();
        } else {
          if (currentQ.explanation) {
            currentQ.explanation += " " + line.text;
          } else {
            const lastOptIdx = currentQ.options.length - 1;
            if (lastOptIdx >= 0) {
              currentQ.options[lastOptIdx] += " " + line.text;
              if (currentQ.optionMetadata[lastOptIdx]) {
                currentQ.optionMetadata[lastOptIdx].text += " " + line.text;
              }
            }
          }
        }
      }
    }
  }

  if (currentQ) {
    if (currentQ.options.length >= 2 && currentQ.question && currentQ.question.trim()) {
      questions.push(currentQ);
    } else {
      skippedCount++;
    }
  }

  return { questions, skippedCount };
}

// Extensible Multi-Strategy Detectors (Layers 2 & 8)
const DETECTORS = [
  {
    name: "separate_answers",
    detect: (q, options, features, context) => {
      if (context.separateAnswersMap && context.separateAnswersMap[q.num] !== undefined) {
        return { strategy: "separate_answers", confidence: 98, answer: context.separateAnswersMap[q.num] };
      }
      return null;
    }
  },
  {
    name: "end_answer_key",
    detect: (q, options, features, context) => {
      if (context.endAnswersMap && context.endAnswersMap[q.num] !== undefined) {
        return { strategy: "end_answer_key", confidence: 95, answer: context.endAnswersMap[q.num] };
      }
      return null;
    }
  },
  {
    name: "plus_symbol",
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => f.hasPlus ? idx : -1).filter(idx => idx !== -1);
      if (matches.length === 1) {
        return { strategy: "plus_symbol", confidence: 95, answer: matches[0] };
      }
      return null;
    }
  },
  {
    name: "checkmark_symbol",
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => f.hasCheck ? idx : -1).filter(idx => idx !== -1);
      if (matches.length === 1) {
        return { strategy: "checkmark_symbol", confidence: 95, answer: matches[0] };
      }
      return null;
    }
  },
  {
    name: "asterisk_symbol",
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => f.hasStar ? idx : -1).filter(idx => idx !== -1);
      if (matches.length === 1) {
        return { strategy: "asterisk_symbol", confidence: 95, answer: matches[0] };
      }
      return null;
    }
  },
  {
    name: "answer_text",
    detect: (q, options, features, context) => {
      if (q.explanation) {
        const textMatch = q.explanation.match(/Answer\s*:\s*([A-E])/i) || 
                          q.explanation.match(/Ans\s*:\s*([A-E])/i) || 
                          q.explanation.match(/Correct\s+Option\s*:\s*([A-E])/i);
        if (textMatch) {
          const idx = textMatch[1].toUpperCase().charCodeAt(0) - 65;
          if (idx >= 0 && idx < options.length) {
            return { strategy: "answer_text", confidence: 95, answer: idx };
          }
        }
      }
      return null;
    }
  },
  {
    name: "highlight_option", // Yellow Highlight
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => (f.isHighlighted && (!f.highlightColor || f.highlightColor === "yellow")) ? idx : -1).filter(idx => idx !== -1);
      if (matches.length === 1) {
        return { strategy: "highlight_option", confidence: 95, answer: matches[0] };
      }
      return null;
    }
  },
  {
    name: "colored_highlight", // Green/Cyan/Pink Highlight
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => (f.isHighlighted && f.highlightColor && f.highlightColor !== "yellow") ? idx : -1).filter(idx => idx !== -1);
      if (matches.length === 1) {
        return { strategy: "colored_highlight", confidence: 95, answer: matches[0] };
      }
      return null;
    }
  },
  {
    name: "underline_option",
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => f.isUnderlined ? idx : -1).filter(idx => idx !== -1);
      if (matches.length === 1) {
        return { strategy: "underline_option", confidence: 92, answer: matches[0] };
      }
      return null;
    }
  },
  {
    name: "bold_option",
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => f.isBold ? idx : -1).filter(idx => idx !== -1);
      const activeOptsCount = options.filter(o => o.length > 0).length;
      if (matches.length === 1 && activeOptsCount > 2) {
        return { strategy: "bold_option", confidence: 90, answer: matches[0] };
      }
      return null;
    }
  },
  {
    name: "colored_option", // Font difference
    detect: (q, options, features, context) => {
      const matches = features.map((f, idx) => f.isColored ? idx : -1).filter(idx => idx !== -1);
      const activeOptsCount = options.filter(o => o.length > 0).length;
      if (matches.length === 1 && activeOptsCount > 2) {
        return { strategy: "colored_option", confidence: 90, answer: matches[0] };
      }
      return null;
    }
  }
];

async function evaluateCorrectAnswers(questions, pdfName, template = null, context = {}) {
  const evaluated = [];

  for (const q of questions) {
    while (q.options.length < 4) {
      q.options.push("");
    }

    let detectedIndex = -1;
    let confidence = 50;
    let matchStrategy = "none";

    const features = q.options.map((optText, idx) => {
      const meta = q.optionMetadata[idx] || {};
      const text = optText || "";
      
      return {
        hasPlus: /\(\+\)|\[\+\]|\+/.test(text) || text.startsWith("+") || text.endsWith("+"),
        hasCheck: /✓|✔/.test(text),
        hasStar: /\*/.test(text),
        isBold: !!meta.isBold,
        isHighlighted: !!meta.isHighlighted,
        highlightColor: meta.highlightColor || null,
        isUnderlined: !!meta.isUnderlined,
        fontNames: meta.fontNames || []
      };
    });

    let dominantFont = "";
    const fontCounts = {};
    features.forEach(f => {
      f.fontNames.forEach(fn => {
        fontCounts[fn] = (fontCounts[fn] || 0) + 1;
      });
    });
    let maxCount = 0;
    Object.entries(fontCounts).forEach(([fn, cnt]) => {
      if (cnt > maxCount) {
        maxCount = cnt;
        dominantFont = fn;
      }
    });

    const optionsCount = q.options.filter(o => o.length > 0).length;
    features.forEach((f, idx) => {
      f.isColored = f.fontNames.length > 0 && !f.fontNames.includes(dominantFont);
    });

    // Enforce matching patterns if pre-saved Template exists (Layer 6)
    if (template && template.answerPattern) {
      const pattern = template.answerPattern;
      const targetDetector = DETECTORS.find(d => d.name === pattern);
      if (targetDetector) {
        const result = targetDetector.detect(q, q.options, features, context);
        if (result) {
          detectedIndex = result.answer;
          confidence = 98;
          matchStrategy = pattern;
        }
      }
    }

    // Default strategy selection loop based on priority (Layer 2)
    if (detectedIndex === -1) {
      for (const detector of DETECTORS) {
        const result = detector.detect(q, q.options, features, context);
        if (result) {
          detectedIndex = result.answer;
          confidence = result.confidence;
          matchStrategy = detector.name;
          break;
        }
      }
    }

    if (detectedIndex !== -1) {
      q.correctAnswer = detectedIndex;
    } else {
      q.correctAnswer = 0;
      confidence = 40;
    }

    // Call Gemini AI Fallback if we have low confidence or no index detected
    if (detectedIndex === -1 || confidence < 90) {
      try {
        const aiResult = await solveQuestionWithAI(q.question, q.options);
        if (aiResult) {
          q.correctAnswer = aiResult.correctAnswer;
          q.explanation = aiResult.explanation;
          confidence = 95; // high confidence from AI validation
          matchStrategy = "gemini_ai_fallback";
        }
      } catch (aiErr) {
        console.warn("AI Fallback failed, proceeding with default logic:", aiErr);
      }
    }

    // Clean options
    q.options = q.options.map(opt => opt.replace(/\(\+\)|\[\+\]|\+|✓|✔|\*/g, "").trim());

    evaluated.push({
      question: q.question.replace(/\s+/g, " ").trim(),
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation || "Extracted from PDF question bank.",
      subject: q.subject,
      chapter: q.chapter || "",
      difficulty: q.difficulty,
      image: q.image || null,
      confidenceScore: confidence,
      status: confidence >= 90 ? "Auto Approved" : "Needs Review",
      pdfName,
      matchStrategy,
      pageNum: q.pageNum,
      optionMetadata: features.map(f => ({
        isBold: f.isBold,
        isHighlighted: f.isHighlighted,
        highlightColor: f.highlightColor || null,
        isUnderlined: f.isUnderlined,
        isColored: !!f.isColored
      }))
    });
  }

  return evaluated;
}

/**
 * OCR extraction fallback pipeline
 */
async function runOcrPipeline(parser, numPages, pdfName) {
  console.log("Rendering screenshots for OCR...");
  let screenshots;
  try {
    // Note: Scanned PDFs still require page screenshots for OCR
    screenshots = await parser.getScreenshot({ scale: 1.5, imageBuffer: true, imageDataUrl: false });
  } catch (err) {
    console.error("Screenshot rendering failed:", err);
    throw new Error("OCR screenshot rendering failed: " + err.message);
  }

  const worker = await createWorker("eng");
  let combinedText = "";

  try {
    for (const pageImg of screenshots.pages) {
      console.log(`Running Tesseract OCR on page ${pageImg.pageNumber}...`);
      try {
        const { data: { text } } = await worker.recognize(pageImg.data);
        combinedText += `\n-- Page ${pageImg.pageNumber} --\n` + text;
      } catch (ocrErr) {
        console.error(`OCR error on page ${pageImg.pageNumber}:`, ocrErr);
      }
    }
  } finally {
    await worker.terminate();
  }

  const { questions: rawQuestions, skippedCount } = parseQuestionsFromText(combinedText);
  const mappedQuestions = rawQuestions.map(q => ({
    ...q,
    confidenceScore: 60, // OCRMarker strategy
    status: "Needs Review",
    pdfName,
    matchStrategy: "ocr_marker"
  }));
  return { questions: mappedQuestions, skippedCount };
}

export function parseQuestionsFromText(text) {
  const questions = [];
  let skippedCount = 0;
  const lines = text.split("\n").map(line => line.trim()).filter(line => line.length > 0);
  let currentQ = null;

  const questionRegex = /^(?:Q|q)?\.?\s*(\d+)(?:\s*[\dots\:\)]\s*(.+)+|\s+["“'‘]?[A-Z].+)/;
  const optionRegex = /^\s*([A-Ea-e])\s*[\dots\:\)]\s*(.+)/;

  for (const line of lines) {
    const qMatch = line.match(questionRegex);
    if (qMatch) {
      if (currentQ) {
        if (currentQ.options.length >= 2 && currentQ.question && currentQ.question.trim()) {
          questions.push(finalizeQuestion(currentQ));
        } else {
          skippedCount++;
        }
      }
      const qText = (qMatch[2] || qMatch[3] || "").trim();
      currentQ = {
        question: qText,
        options: [],
        correctAnswer: 0,
        explanation: "Extracted via OCR fallback.",
        subject: "General Medicine",
        difficulty: "Medium"
      };
      continue;
    }

    if (currentQ) {
      const optMatch = matchOptionLine(line);
      if (optMatch) {
        currentQ.options.push(optMatch.text);
        continue;
      }
    }

    if (currentQ) {
      if (currentQ.options.length === 0) {
        currentQ.question += " " + line;
      } else {
        if (line.toLowerCase().startsWith("explanation:") || line.toLowerCase().startsWith("ans:")) {
          currentQ.explanation = line.replace(/^(explanation|ans)\s*:\s*/i, "").trim();
        } else if (line.toLowerCase().startsWith("subject:")) {
          currentQ.subject = line.replace(/^subject\s*:\s*/i, "").trim();
        }
      }
    }
  }

  if (currentQ) {
    if (currentQ.options.length >= 2 && currentQ.question && currentQ.question.trim()) {
      questions.push(finalizeQuestion(currentQ));
    } else {
      skippedCount++;
    }
  }

  return { questions, skippedCount };
}

function finalizeQuestion(q) {
  q.question = q.question.replace(/\s+/g, " ").trim();
  q.explanation = q.explanation.replace(/\s+/g, " ").trim();

  const markers = [/\(\+\)/, /\[\+\]/, /\+/, /✓/, /✔/, /\*/];
  let markedIndex = -1;

  for (let i = 0; i < q.options.length; i++) {
    for (const marker of markers) {
      if (marker.test(q.options[i])) {
        markedIndex = i;
        break;
      }
    }
    if (markedIndex !== -1) break;
  }

  if (markedIndex !== -1) {
    q.correctAnswer = markedIndex;
  } else {
    const ansMatch = q.explanation.match(/Answer\s*:\s*([A-E])/i) || q.explanation.match(/Ans\s*:\s*([A-E])/i);
    if (ansMatch) {
      q.correctAnswer = ansMatch[1].toUpperCase().charCodeAt(0) - 65;
    } else {
      q.correctAnswer = 0;
    }
  }

  q.options = q.options.map(opt => opt.replace(/\(\+\)|\[\+\]|\+|✓|✔|\*/g, "").trim());
  return q;
}
