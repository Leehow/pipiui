/**
 * Placeholder toolRenderer for `repo_map`.
 */
export default function MapCard(props: { content: string; details?: unknown }) {
  const details = props.details as { degraded?: boolean } | undefined;
  const degraded = details?.degraded === true;
  return (
    <div data-testid="code-retrieval-map-card">
      <div>{degraded ? "仓库地图已降级" : "仓库地图"}</div>
      <pre>{props.content}</pre>
    </div>
  );
}
