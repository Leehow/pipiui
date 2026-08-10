/** Per-main-repository FIFO serialization for operations that mutate main. */

export interface MainRepoSerialQueueV1 {
	run<T>(repositoryKey: string, operation: () => Promise<T> | T): Promise<T>;
}

/**
 * Independent repositories may finalize concurrently; every operation sharing a
 * canonical Git common-dir key executes in FIFO order. Failed operations release
 * their slot so a retained/retry state cannot deadlock later work.
 */
export class PerMainRepoSerialQueueV1 implements MainRepoSerialQueueV1 {
	private readonly tails = new Map<string, Promise<void>>();

	async run<T>(repositoryKey: string, operation: () => Promise<T> | T): Promise<T> {
		const key = repositoryKey || "<unknown-main-repository>";
		const previous = this.tails.get(key) ?? Promise.resolve();
		let release: (() => void) | undefined;
		const current = new Promise<void>((resolve) => { release = resolve; });
		const tail = previous.catch(() => undefined).then(() => current);
		this.tails.set(key, tail);
		await previous.catch(() => undefined);
		try {
			return await operation();
		} finally {
			release?.();
			void tail.finally(() => {
				if (this.tails.get(key) === tail) this.tails.delete(key);
			});
		}
	}
}
