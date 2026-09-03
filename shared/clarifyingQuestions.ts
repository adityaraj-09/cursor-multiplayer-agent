import type { ClarifyingQuestion, ClarifyingQuestionOption } from "./events.js";

const QUESTION_TOOL_RE =
  /^(askuserquestion|askfollowupquestion|askquestion|ask_user|ask_followup_question|ask_user_question|clarify|question|userinput|getinput)/i;

/** Whether a tool name represents an agent asking the user clarifying questions. */
export function isQuestionTool(name: string): boolean {
  return QUESTION_TOOL_RE.test(name.replace(/ToolCall$/i, ""));
}

/**
 * Parse structured clarifying questions from tool input/arguments.
 * Supports Claude Code's AskUserQuestion schema as well as general key/value formats.
 */
export function parseQuestionToolArgs(
  args: Record<string, unknown> | unknown,
): ClarifyingQuestion[] {
  if (!args || typeof args !== "object") return [];
  const raw = args as Record<string, unknown>;

  // Case 1: questions array (Claude Code / Agent SDK standard)
  if (Array.isArray(raw.questions)) {
    const list: ClarifyingQuestion[] = [];
    for (let i = 0; i < raw.questions.length; i++) {
      const q = raw.questions[i];
      if (typeof q === "string" && q.trim()) {
        list.push({ id: `q-${i + 1}`, question: q.trim() });
      } else if (q && typeof q === "object") {
        const item = q as Record<string, unknown>;
        const questionText = String(
          item.question ?? item.prompt ?? item.text ?? item.title ?? "",
        ).trim();
        if (!questionText) continue;
        const header =
          typeof item.header === "string" ? item.header.trim() : undefined;
        const multiSelect = Boolean(item.multiSelect);
        let options: ClarifyingQuestionOption[] | undefined;
        if (Array.isArray(item.options)) {
          options = item.options
            .map((opt) => {
              if (typeof opt === "string" && opt.trim()) {
                return { label: opt.trim() };
              }
              if (opt && typeof opt === "object") {
                const o = opt as Record<string, unknown>;
                const label = String(o.label ?? o.text ?? o.title ?? "").trim();
                const description =
                  typeof o.description === "string"
                    ? o.description.trim()
                    : undefined;
                if (label) return { label, description };
              }
              return null;
            })
            .filter((o): o is ClarifyingQuestionOption => o !== null);
        }
        list.push({
          id: String(item.id || `q-${i + 1}`),
          question: questionText,
          header,
          options: options && options.length ? options : undefined,
          multiSelect,
        });
      }
    }
    if (list.length) return list;
  }

  // Case 2: single question object
  const singleText = String(
    raw.question ?? raw.prompt ?? raw.query ?? raw.message ?? "",
  ).trim();
  if (singleText) {
    let options: ClarifyingQuestionOption[] | undefined;
    if (Array.isArray(raw.options)) {
      options = raw.options
        .map((opt) => {
          if (typeof opt === "string" && opt.trim()) {
            return { label: opt.trim() };
          }
          if (opt && typeof opt === "object") {
            const o = opt as Record<string, unknown>;
            const label = String(o.label ?? o.text ?? o.title ?? "").trim();
            const description =
              typeof o.description === "string" ? o.description.trim() : undefined;
            if (label) return { label, description };
          }
          return null;
        })
        .filter((o): o is ClarifyingQuestionOption => o !== null);
    }
    return [
      {
        id: "q-1",
        question: singleText,
        header: typeof raw.header === "string" ? raw.header.trim() : undefined,
        options: options && options.length ? options : undefined,
        multiSelect: Boolean(raw.multiSelect),
      },
    ];
  }

  return [];
}

const CLARIFYING_PROSE_CUES = [
  /\bclarifying questions?\b/i,
  /\ba few questions before\b/i,
  /\bquestions before I (?:proceed|start|continue|make|implement)\b/i,
  /\bbefore (?:we|I) (?:proceed|start|continue)\b/i,
  /\bcould you (?:please )?clarify\b/i,
  /\bplease clarify\b/i,
  /\bwhich (?:option|approach|alternative) would you prefer\b/i,
  /\bdo you prefer\b/i,
  /\bwhich do you prefer\b/i,
  /\bto help me proceed\b/i,
];

/**
 * Detects if an assistant response contains clarifying questions in prose/markdown.
 * Returns structured questions with possible options, or null if not a clarifying message.
 */
export function detectClarifyingQuestions(
  content: string,
): ClarifyingQuestion[] | null {
  if (!content || !content.trim()) return null;
  const trimmed = content.trim();

  const hasCue = CLARIFYING_PROSE_CUES.some((cue) => cue.test(trimmed));
  const hasQuestionMark = trimmed.includes("?");

  if (!hasCue && !hasQuestionMark) return null;

  // Split into lines to extract numbered or bulleted questions
  const lines = trimmed.split("\n");
  const questions: ClarifyingQuestion[] = [];

  let currentQuestion: ClarifyingQuestion | null = null;
  let inQuestionsSection = !hasCue; // if no specific cue word but looks like questions

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if line indicates start of questions section
    if (CLARIFYING_PROSE_CUES.some((cue) => cue.test(line))) {
      inQuestionsSection = true;
      continue;
    }

    // Match numbered list: "1. Question text?" or "1) Question text?"
    const numberedMatch = line.match(/^(\d+)[\.\)]\s+(.+)$/);
    // Match bullet list: "- Question text?" or "* Question text?"
    const bulletMatch = line.match(/^[-*•]\s+(.+)$/);

    if (numberedMatch) {
      const text = numberedMatch[2].trim();
      if (text.includes("?") || inQuestionsSection) {
        if (currentQuestion) questions.push(currentQuestion);
        currentQuestion = {
          id: `q-${questions.length + 1}`,
          question: text.replace(/^\*\*|\*\*$/g, ""),
          options: [],
        };
        continue;
      }
    } else if (bulletMatch) {
      const text = bulletMatch[1].trim();
      // If we are currently inside a question, check if this bullet is an option (e.g. "- Option A")
      if (currentQuestion && !text.endsWith("?")) {
        const optLabel = text.replace(/^\[[ x]\]\s*/i, "").replace(/^\*\*|\*\*$/g, "").trim();
        if (optLabel && optLabel.length < 80) {
          if (!currentQuestion.options) currentQuestion.options = [];
          currentQuestion.options.push({ label: optLabel });
          continue;
        }
      }

      if (text.includes("?") || inQuestionsSection) {
        if (currentQuestion) questions.push(currentQuestion);
        currentQuestion = {
          id: `q-${questions.length + 1}`,
          question: text.replace(/^\*\*|\*\*$/g, ""),
          options: [],
        };
        continue;
      }
    } else if (line.endsWith("?") && inQuestionsSection && line.length < 200) {
      if (currentQuestion) questions.push(currentQuestion);
      currentQuestion = {
        id: `q-${questions.length + 1}`,
        question: line.replace(/^\*\*|\*\*$/g, ""),
        options: [],
      };
    }
  }

  if (currentQuestion) {
    questions.push(currentQuestion);
  }

  // Clean up options
  const cleanList = questions
    .filter((q) => q.question.trim().length > 0)
    .map((q) => ({
      ...q,
      options: q.options && q.options.length ? q.options : undefined,
    }));

  if (cleanList.length > 0 && hasCue) {
    return cleanList;
  }

  // If cue was present but no list extracted, and trimmed ends with ?, use entire closing sentence
  if (hasCue && cleanList.length === 0 && hasQuestionMark) {
    const sentences = trimmed.split(/(?<=[.?!])\s+/);
    const qSentences = sentences.filter((s) => s.trim().endsWith("?"));
    if (qSentences.length > 0 && qSentences.length <= 3) {
      return qSentences.map((q, idx) => ({
        id: `q-${idx + 1}`,
        question: q.trim(),
      }));
    }
  }

  return cleanList.length > 0 ? cleanList : null;
}
