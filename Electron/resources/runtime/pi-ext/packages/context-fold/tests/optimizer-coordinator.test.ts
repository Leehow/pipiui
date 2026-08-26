import { afterEach, describe, expect, it } from "vitest";
import {
	armContextRewrite,
	beginContextOptimizerSession,
	beginContextRewriteTurn,
	clearContextOptimizerState,
	configureContextRewriteGate,
	contextOptimizerState,
	contextRewriteIsAllowed,
	disarmContextRewrite,
	finishContextRewriteTurn,
} from "../src/adapters/pi/optimizer-coordinator";

afterEach(() => clearContextOptimizerState());

describe("shared model-visible rewrite gate", () => {
	it("opens one stable turn only after the quiet deadline arms it", () => {
		beginContextOptimizerSession("s1");
		configureContextRewriteGate("s1", 0.45, 240_000);
		expect(contextRewriteIsAllowed("s1")).toBe(false);

		beginContextRewriteTurn("s1");
		expect(contextRewriteIsAllowed("s1")).toBe(false);

		armContextRewrite("s1", 1234);
		expect(contextOptimizerState("s1")?.rewriteGate).toMatchObject({ armed: true, armedAt: 1234 });
		beginContextRewriteTurn("s1");
		expect(contextRewriteIsAllowed("s1")).toBe(true);
		expect(contextOptimizerState("s1")?.rewriteGate?.armed).toBe(false);

		finishContextRewriteTurn("s1");
		expect(contextRewriteIsAllowed("s1")).toBe(false);
	});

	it("manual disarm closes both a pending arm and an active epoch", () => {
		beginContextOptimizerSession("s1");
		configureContextRewriteGate("s1", 0.45, 240_000);
		armContextRewrite("s1");
		beginContextRewriteTurn("s1");
		expect(contextRewriteIsAllowed("s1")).toBe(true);
		disarmContextRewrite("s1");
		expect(contextOptimizerState("s1")?.rewriteGate).toMatchObject({ armed: false, activeTurn: false });
	});
});
