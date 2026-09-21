/**
 * Event questionnaires: what an organiser may define, and what a member may
 * answer.
 *
 * Both halves live together for the same reason party.ts keeps pricing and
 * capacity together — the rules have to agree. A question the admin form
 * accepts but the registration route rejects would let an organiser build a
 * session nobody can book, and the failure would land on a member rather than
 * on the person who made it.
 */

/** How many questions one event may ask. Enough to be useful, short enough to fill in. */
export const MAX_QUESTIONS = 10;
/** Choices per question. */
export const MAX_OPTIONS = 12;

const MAX_PROMPT_LENGTH = 160;
const MAX_OPTION_LENGTH = 80;
const MAX_ANSWER_LENGTH = 300;

export type QuestionKind = "CHOICE" | "TEXT";

export interface QuestionInput {
    prompt: string;
    kind: QuestionKind;
    options: string[];
    required: boolean;
    position: number;
}

export interface QuestionParseResult {
    ok: boolean;
    error?: string;
    questions?: QuestionInput[];
}

/**
 * Validates a questionnaire an organiser is saving.
 *
 * Passing an empty list is how the questionnaire is turned off for an event —
 * the client asked for enable/disable, and "no questions" is the same state
 * with one fewer flag to keep in step with the list it guards.
 */
export function parseQuestions(raw: unknown): QuestionParseResult {
    if (raw === undefined || raw === null) return { ok: true, questions: [] };
    if (!Array.isArray(raw)) return { ok: false, error: "The questionnaire must be a list" };

    if (raw.length > MAX_QUESTIONS) {
        return {
            ok: false,
            error: `An event can ask at most ${MAX_QUESTIONS} questions — this one has ${raw.length}.`,
        };
    }

    const questions: QuestionInput[] = [];

    for (const [i, entry] of raw.entries()) {
        const position = i + 1;
        if (!entry || typeof entry !== "object") {
            return { ok: false, error: `Question ${position} is empty` };
        }

        const prompt = typeof (entry as any).prompt === "string" ? (entry as any).prompt.trim() : "";
        if (prompt.length < 3) {
            return { ok: false, error: `Give question ${position} a prompt of at least 3 characters` };
        }
        if (prompt.length > MAX_PROMPT_LENGTH) {
            return {
                ok: false,
                error: `Question ${position}'s prompt is too long (${MAX_PROMPT_LENGTH} characters max)`,
            };
        }

        const kind: QuestionKind = (entry as any).kind === "TEXT" ? "TEXT" : "CHOICE";

        let options: string[] = [];
        if (kind === "CHOICE") {
            const rawOptions = Array.isArray((entry as any).options) ? (entry as any).options : [];
            options = rawOptions
                .map((o: unknown) => (typeof o === "string" ? o.trim() : ""))
                .filter((o: string) => o.length > 0);

            /* Two, not one. A pick-one with a single choice asks the member to
               confirm something the organiser already knew, and is nearly
               always a half-finished question rather than an intended one. */
            if (options.length < 2) {
                return {
                    ok: false,
                    error: `"${prompt}" needs at least 2 answer options, or change it to a free-text question.`,
                };
            }
            if (options.length > MAX_OPTIONS) {
                return {
                    ok: false,
                    error: `"${prompt}" has more than ${MAX_OPTIONS} options.`,
                };
            }
            if (options.some((o: string) => o.length > MAX_OPTION_LENGTH)) {
                return {
                    ok: false,
                    error: `An option on "${prompt}" is too long (${MAX_OPTION_LENGTH} characters max)`,
                };
            }
            /* Duplicates make a response ambiguous once it is exported: two
               identical cells that meant different rows in the form. */
            if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
                return { ok: false, error: `"${prompt}" repeats an answer option.` };
            }
        }

        questions.push({
            prompt,
            kind,
            options,
            required: (entry as any).required === true,
            position: i,
        });
    }

    return { ok: true, questions };
}

/** A question as stored, with `options` still JSON-encoded. */
export interface StoredQuestion {
    id: string;
    prompt: string;
    kind: string;
    options: string;
    required: boolean;
    position: number;
}

/** The same, ready to send to a client. */
export interface PublicQuestion {
    id: string;
    prompt: string;
    kind: string;
    options: string[];
    required: boolean;
    position: number;
}

/**
 * Decodes a stored question for the wire.
 *
 * Tolerant of a malformed `options` because the column is text: a bad value
 * should cost that question its choices, not blow up the event page for
 * everybody.
 */
export function toPublicQuestion(q: StoredQuestion): PublicQuestion {
    let options: string[] = [];
    try {
        const parsed = JSON.parse(q.options);
        if (Array.isArray(parsed)) options = parsed.filter((o) => typeof o === "string");
    } catch {
        options = [];
    }
    return {
        id: q.id,
        prompt: q.prompt,
        kind: q.kind,
        options,
        required: q.required,
        position: q.position,
    };
}

export interface AnswerParseResult {
    ok: boolean;
    error?: string;
    /** Question id → answer, ready to write. */
    answers?: { question_id: string; answer: string }[];
}

/**
 * Checks a member's answers against the event's questions at booking time.
 *
 * Driven by the questions rather than by the submission: anything the member
 * sent for a question this event does not ask is dropped rather than stored,
 * so a stale form open in another tab cannot write rows that no report knows
 * how to read.
 */
export function parseAnswers(
    raw: unknown,
    questions: PublicQuestion[],
): AnswerParseResult {
    if (questions.length === 0) return { ok: true, answers: [] };

    const submitted: Record<string, unknown> =
        raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as any) : {};

    const answers: { question_id: string; answer: string }[] = [];

    for (const question of questions) {
        const value = submitted[question.id];
        const answer = typeof value === "string" ? value.trim() : "";

        if (!answer) {
            if (question.required) {
                return { ok: false, error: `Please answer "${question.prompt}".` };
            }
            continue;
        }

        if (question.kind === "CHOICE" && !question.options.includes(answer)) {
            return {
                ok: false,
                error: `"${answer}" is not one of the choices for "${question.prompt}".`,
            };
        }
        if (answer.length > MAX_ANSWER_LENGTH) {
            return {
                ok: false,
                error: `Your answer to "${question.prompt}" is too long (${MAX_ANSWER_LENGTH} characters max)`,
            };
        }

        answers.push({ question_id: question.id, answer });
    }

    return { ok: true, answers };
}
