// Semantic goal identity: short, readable, deterministic, and unique per instance.
//
// The goal_id is echoed in prompts and repeated by the model in goal_complete,
// goal_blocked, and goal_wait as a stale-turn guard. A random UUID is hard to
// retype exactly and unreadable in status output, so the id is instead built
// from the objective text: `<slug>.<generation>` (e.g. `fix-login-race.2`).
// The slug is derived deterministically from the text; the decimal generation
// is allocated monotonically per slug by GoalIdSequence so repeated objectives,
// resumes, and edits never reuse an id the model has already seen.

/** Longest id the goal tools accept (schema maxLength and stale-guard check). */
export const MAX_GOAL_ID_LENGTH = 128;

const GOAL_SLUG_MAX_LENGTH = 40;
const GOAL_SLUG_FALLBACK = "goal";
const MAX_GOAL_GENERATION = 1_000_000_000;

const GOAL_SLUG_PATTERN = new RegExp(
	`^[\\p{L}\\p{N}][\\p{L}\\p{N}-]{0,${GOAL_SLUG_MAX_LENGTH - 1}}$`,
	"u",
);
const GOAL_GENERATION_PATTERN = /^[1-9][0-9]{0,8}$/;

/** Deterministic, readable kebab-case slug derived from the objective text. */
export function goalSlug(text: string): string {
	const slug = text
		.normalize("NFKD")
		.toLowerCase()
		.replace(/\p{M}+/gu, "")
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/gu, "")
		.slice(0, GOAL_SLUG_MAX_LENGTH)
		.replace(/-+$/gu, "");
	return slug || GOAL_SLUG_FALLBACK;
}

export function buildGoalId(slug: string, generation: number): string {
	if (!Number.isSafeInteger(generation) || generation < 1 || generation > MAX_GOAL_GENERATION) {
		throw new Error(`Invalid goal id generation: ${generation}`);
	}
	const id = `${slug}.${generation}`;
	if (id.length > MAX_GOAL_ID_LENGTH) {
		throw new Error(`Goal id exceeds ${MAX_GOAL_ID_LENGTH} characters: ${id.length}`);
	}
	return id;
}

/**
 * Splits a semantic goal id into its slug and generation parts. Returns
 * undefined for ids that predate this scheme (random UUIDs) or any other
 * non-`<slug>.<generation>` form; those stay valid goal ids, they just cannot
 * seed or continue a slug's generation sequence.
 */
export function parseGoalId(id: string): { slug: string; generation: number } | undefined {
	const dot = id.lastIndexOf(".");
	if (dot <= 0) return undefined;
	const slug = id.slice(0, dot);
	const generationText = id.slice(dot + 1);
	if (!GOAL_GENERATION_PATTERN.test(generationText)) return undefined;
	if (!GOAL_SLUG_PATTERN.test(slug)) return undefined;
	const generation = Number(generationText);
	if (generation > MAX_GOAL_GENERATION) return undefined;
	return { slug, generation };
}

/**
 * Allocates `<slug>.<generation>` ids for one extension runtime. Deterministic
 * and monotonic per slug: the next id for a slug is always the previous
 * generation + 1, so ids are readable (`fix-login.2` reads as "second
 * instance") and never collide with an id already handed to the model.
 *
 * The full slug → generation map is retained for the runtime's lifetime and
 * snapshotted into every persisted goal-state entry, and session start seeds
 * from both the restored map and the active goal id. Evicting old slugs (an
 * earlier size cap) would let a forgotten slug reissue `<slug>.1` after a
 * reload — an id the model may still repeat, defeating the stale-turn guard —
 * so no slug is ever evicted. The map only grows with distinct objective
 * texts; entries are small, and the cost of retaining them is what guarantees
 * an issued id is never reissued.
 */
export class GoalIdSequence {
	private readonly generations = new Map<string, number>();

	/** Remembers the generation carried by an existing goal id (never lowers one). */
	seed(goalId: string) {
		const parsed = parseGoalId(goalId);
		if (!parsed) return;
		this.remember(parsed.slug, parsed.generation);
	}

	/** Restores a persisted sequence snapshot; invalid entries are ignored. */
	restore(data: unknown) {
		if (typeof data !== "object" || data === null || Array.isArray(data)) return;
		for (const [slug, generation] of Object.entries(data)) {
			if (!GOAL_SLUG_PATTERN.test(slug)) continue;
			if (
				typeof generation !== "number" ||
				!Number.isSafeInteger(generation) ||
				generation < 1 ||
				generation > MAX_GOAL_GENERATION
			) {
				continue;
			}
			this.remember(slug, generation);
		}
	}

	/**
	 * Allocates the next id for a goal with this text. `mustDifferFrom` guards
	 * rotation: a resumed/edited goal must never keep the id the model already
	 * saw, so the stale-turn guard still rejects replayed calls.
	 */
	allocate(text: string, mustDifferFrom?: string): string {
		const slug = goalSlug(text);
		let generation = (this.generations.get(slug) ?? 0) + 1;
		if (generation > MAX_GOAL_GENERATION) {
			throw new Error(`Goal id generation overflow for slug ${slug}`);
		}
		if (mustDifferFrom !== undefined && buildGoalId(slug, generation) === mustDifferFrom) {
			generation += 1;
		}
		const id = buildGoalId(slug, generation);
		this.generations.set(slug, generation);
		return id;
	}

	/** Persistable snapshot: slug → highest allocated generation (never evicted). */
	snapshot(): Record<string, number> {
		const snapshot: Record<string, number> = {};
		for (const [slug, generation] of this.generations) {
			snapshot[slug] = generation;
		}
		return snapshot;
	}

	private remember(slug: string, generation: number) {
		const known = this.generations.get(slug) ?? 0;
		if (generation > known) this.generations.set(slug, generation);
	}
}
