/**
 * Placeholder toolRenderer for `code_search`. Host falls back to the default
 * card if this module fails to parse details.
 */
export default function SearchCard(props: { content: string; details?: unknown }) {
  const details = props.details as { degraded?: boolean; kind?: string } | undefined;
  const degraded = details?.degraded === true;
  return (
    <div data-testid="code-retrieval-search-card">
      <div>{degraded ? "检索已降级" : "检索"}</div>
      <pre>{props.content}</pre>
    </div>
  );
}
