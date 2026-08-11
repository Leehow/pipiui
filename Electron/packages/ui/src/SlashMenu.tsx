import type { SlashCommandDef } from './slash-commands'

/**
 * Slash command candidate popover rendered above the composer while the draft
 * is a bare `/query`. Mirrors Swift `SlashPalette`: fuzzy-ranked rows, keyboard
 * selection handled by the composer (↑/↓/Enter/Esc/Tab), click-outside close.
 */
export function SlashMenu({ commands, selectedIndex, onHighlight, onSelect, onDismiss }: {
  commands: SlashCommandDef[]
  selectedIndex: number
  onHighlight: (index: number) => void
  onSelect: (command: SlashCommandDef) => void
  onDismiss: () => void
}) {
  return <>
    <div className="slash-backdrop" data-testid="slash-backdrop" onMouseDown={onDismiss} />
    <div className="slash-menu" role="listbox" aria-label="斜杠命令" data-testid="slash-menu">
      {commands.length === 0
        ? <div className="slash-empty" data-testid="slash-empty">无匹配命令</div>
        : commands.map((command, index) => {
          const selected = index === selectedIndex
          return (
            <button
              key={command.name}
              type="button"
              role="option"
              aria-selected={selected}
              data-testid={`slash-row-${command.name}`}
              className={`slash-row ${selected ? 'selected' : ''}`}
              onMouseEnter={() => onHighlight(index)}
              onMouseDown={event => { event.preventDefault(); onSelect(command) }}
            >
              <span className="slash-name">/{command.name}</span>
              {command.description && <span className="slash-desc">{command.description}</span>}
            </button>
          )
        })}
    </div>
  </>
}
