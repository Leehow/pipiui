import { useEffect, useRef, useState } from 'react'
import type { RailPrompt } from './prompt-rail'
import './prompt-rail.css'

/**
 * Left-edge user-prompt navigation rail.
 *
 * Mirrors Swift `UserPromptNavigationRail`: a compact vertical index fixed to
 * the left of the transcript. All eligible user prompts are laid out as a
 * dense list (fixed 8px pitch, viewport-height-constrained with internal
 * scroll) — never spread across the transcript's real message height. Each
 * item is a tiny horizontal tick (inactive 9px, active 14px accent). A wide horizontal
 * summary card appears on the rail's right on hover/focus; click scrolls the
 * transcript to that prompt. Hidden entirely when there are no eligible
 * prompts.
 */

/** Swift-style dense pitch between adjacent tick slots. */
export const RAIL_TICK_PITCH = 8
/** Near-zero top/bottom padding inside the tick list. */
export const RAIL_TICK_PADDING = 1
/** Tooltip label for empty-content (image-only) prompts instead of an empty box. */
export const IMAGE_ONLY_FALLBACK = '图片消息'

export function PromptRail({ prompts, activeId, onJump }: {
  prompts: RailPrompt[]
  activeId: string | null
  onJump: (index: number, id: string) => void
}) {
  const [tip, setTip] = useState<{ prompt: RailPrompt; position: number; scrollTop: number } | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  if (prompts.length === 0) return null

  const showTip = (prompt: RailPrompt, position: number) => {
    setTip({ prompt, position, scrollTop: scrollRef.current?.scrollTop ?? 0 })
  }
  const hideTip = (prompt: RailPrompt) => setTip(current => (current?.prompt.id === prompt.id ? null : current))
  const tipText = tip ? tip.prompt.summary || IMAGE_ONLY_FALLBACK : ''
  // Center of tick `position` inside the rail, adjusted for the rail's own scroll.
  const tipTop = tip
    ? RAIL_TICK_PADDING + tip.position * RAIL_TICK_PITCH + RAIL_TICK_PITCH / 2 - tip.scrollTop
    : 0

  return (
    <nav
      className="prompt-rail"
      aria-label="用户输入导航"
      data-testid="prompt-rail"
      style={{ ['--rail-pitch' as string]: `${RAIL_TICK_PITCH}px` }}
    >
      <div
        className="prompt-rail-scroll"
        ref={scrollRef}
        onScroll={() => {
          // Keep an open tooltip glued to its tick while the rail scrolls.
          setTip(current => {
            if (!current) return current
            const scrollTop = scrollRef.current?.scrollTop ?? 0
            return scrollTop === current.scrollTop ? current : { ...current, scrollTop }
          })
        }}
      >
        {prompts.map((prompt, position) => {
          const active = prompt.id === activeId
          return (
            <button
              key={prompt.id}
              type="button"
              className="prompt-rail-tick"
              data-active={active || undefined}
              aria-label={`用户输入 ${position + 1}/${prompts.length}`}
              aria-current={active ? 'true' : undefined}
              aria-describedby={tip?.prompt.id === prompt.id ? 'prompt-rail-tooltip' : undefined}
              onMouseEnter={() => showTip(prompt, position)}
              onMouseLeave={() => hideTip(prompt)}
              onFocus={() => showTip(prompt, position)}
              onBlur={() => hideTip(prompt)}
              onClick={() => onJump(prompt.index, prompt.id)}
            />
          )
        })}
      </div>
      {tip && (
        <div
          id="prompt-rail-tooltip"
          className="prompt-rail-tooltip"
          role="tooltip"
          data-testid="prompt-rail-tooltip"
          style={{ ['--tip-top' as string]: `${tipTop}px` }}
        >
          {tipText}
        </div>
      )}
    </nav>
  )
}

/**
 * Resolve which user prompt is "current" for the rail.
 *
 * Mirrors Swift's `resolvedCurrentMessageID`: while live (following output)
 * the latest user prompt is current; while browsing history the bottom-most
 * *visible* user prompt in the transcript viewport is current. An
 * IntersectionObserver rooted at the transcript container tracks visible user
 * messages; it degrades gracefully to the live rule when the browser has no
 * IntersectionObserver (e.g. jsdom).
 *
 * The returned `containerRef` must be attached to the transcript container so
 * the observer can measure visibility against it.
 */
export function useActivePromptId(prompts: RailPrompt[], atBottom: boolean): { activeId: string | null; containerRef: React.RefObject<HTMLDivElement> } {
  const containerRef = useRef<HTMLDivElement>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const promptsRef = useRef(prompts)
  promptsRef.current = prompts

  // Live/latest → last user node (Swift parity, and the no-IO fallback).
  useEffect(() => {
    if (atBottom && prompts.length > 0) setActiveId(prompts[prompts.length - 1].id)
  }, [atBottom, prompts])

  // Viewport-derived active while browsing history.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined' || typeof MutationObserver === 'undefined') return
    const root = containerRef.current
    if (!root) return

    const visible = new Map<string, number>() // prompt id → message index
    let raf = 0
    const pickBottomMost = () => {
      const indexById = new Map(promptsRef.current.map(p => [p.id, p.index]))
      let bestId: string | null = null
      let bestIndex = -1
      for (const [id, index] of visible) {
        const resolved = indexById.get(id) ?? index
        if (resolved > bestIndex) { bestIndex = resolved; bestId = id }
      }
      if (bestId) setActiveId(bestId)
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const el = entry.target as HTMLElement
        const id = el.dataset.userPrompt
        if (!id) continue
        if (entry.isIntersecting) visible.set(id, Number(el.dataset.userIndex ?? -1))
        else visible.delete(id)
      }
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(pickBottomMost)
    }, { root, threshold: 0 })

    const observed = new Set<Element>()
    const scan = () => {
      root.querySelectorAll<HTMLElement>('[data-user-prompt]').forEach(el => {
        if (!observed.has(el)) { observed.add(el); observer.observe(el) }
      })
    }
    scan()
    const mo = new MutationObserver(scan)
    mo.observe(root, { childList: true, subtree: true })
    return () => { observer.disconnect(); mo.disconnect(); cancelAnimationFrame(raf) }
  }, [prompts])

  return { activeId, containerRef }
}
