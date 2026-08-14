/** True when a persisted subagent override names both its Pi provider and model id. */
export function isProviderQualifiedModelRef(value: string): boolean {
	const ref = value.trim();
	const slash = ref.indexOf("/");
	return slash > 0 && slash < ref.length - 1;
}

/**
 * New Electron selections are always `provider/model`. A historical bare model
 * may only reach runtime when it could not be migrated from the current model
 * catalog; stop before invoking Pi rather than letting Pi choose or reject an
 * ambiguous provider implicitly.
 */
export function checkedSubagentOverrideModel(agentName: string, value: string): string {
	const ref = value.trim();
	if (!isProviderQualifiedModelRef(ref)) {
		throw new Error(
			`Subagent ${agentName} 的历史模型设置 “${ref}” 缺少 provider。请在 Subagent 模型设置中重新选择明确的 provider/model。`,
		);
	}
	return ref;
}
