import './dismissible-error.css'

/**
 * Minimal shared dismissible error. Every persistent user-visible error must
 * offer an explicit close control (CONSTITUTION.md §0); this is the single
 * implementation for that rule. Deliberately not a toast framework:
 * the panel owns placement (via `className`) and lifecycle.
 */
export function DismissibleError({ message, onDismiss, onRetry, className }: {
  message: string
  onDismiss: () => void
  onRetry?: () => void
  className?: string
}) {
  return <div className={className ? `dismissible-error ${className}` : 'dismissible-error'} role="alert" data-testid="dismissible-error">
    <p className="dismissible-error-message">{message}</p>
    {onRetry && <button type="button" className="dismissible-error-retry" onClick={onRetry}>重试</button>}
    <button type="button" className="dismissible-error-close" aria-label="关闭错误提示" title="关闭错误提示" onClick={onDismiss}>×</button>
  </div>
}
