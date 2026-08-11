import './computer-use.css'

/** Deliberate Electron MVP placeholder: this host has no relay/QR pairing API yet. */
export function RemoteConnectionPanel({ onClose }: { onClose: () => void }) {
  return (
    <div className="settings-modal-backdrop" data-testid="remote-connection-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section className="settings-modal remote-connection-panel" role="dialog" aria-modal="true" aria-label="远程控制" data-testid="remote-connection-panel">
        <header className="settings-modal-header">
          <div>
            <h2>远程控制</h2>
            <p>通过二维码连接其他设备。</p>
          </div>
          <button className="settings-modal-close" aria-label="关闭远程控制" onClick={onClose}>×</button>
        </header>
        <div className="settings-modal-empty">当前连接未提供远程配对能力</div>
      </section>
    </div>
  )
}
