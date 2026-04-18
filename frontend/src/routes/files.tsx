import { createFileRoute, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import FileGridPreview from '../components/file-grid-preview'
import {
  idbListDocuments,
  type AvnacEditorIdbListItem,
} from '../lib/avnac-editor-idb'

export const Route = createFileRoute('/files')({
  component: FilesPage,
})

function formatUpdatedAt(ts: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(ts))
  } catch {
    return new Date(ts).toLocaleString()
  }
}

function FilesPage() {
  const [items, setItems] = useState<AvnacEditorIdbListItem[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void idbListDocuments()
      .then((list) => {
        if (!cancelled) setItems(list)
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('Could not load files.')
          setItems([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main className="hero-page relative flex min-h-[100dvh] flex-col overflow-hidden">
      <div className="hero-bg-orb hero-bg-orb-a" aria-hidden="true" />
      <div className="hero-bg-orb hero-bg-orb-b" aria-hidden="true" />
      <div className="hero-grid" aria-hidden="true" />

      <div className="relative z-[1] flex flex-1 flex-col">
        <header className="px-5 pt-4 sm:px-8 sm:pt-5">
          <div className="mx-auto flex max-w-6xl justify-end">
            <Link
              to="/create"
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[var(--text)] px-6 py-2.5 text-[15px] font-medium text-white no-underline transition hover:bg-[#262626] sm:min-h-12 sm:px-8 sm:py-3 sm:text-[1.0625rem]"
            >
              New file
            </Link>
          </div>
        </header>

        <div className="mx-auto w-full max-w-6xl flex-1 px-5 py-12 sm:px-8 sm:py-16 lg:py-20">
          <div className="rise-in">
            <h1 className="display-title mb-4 text-[clamp(2rem,5vw,3.25rem)] font-medium leading-[1.06] tracking-[-0.03em] text-[var(--text)]">
              Files
            </h1>
            <p className="mb-12 max-w-xl text-lg leading-[1.6] text-[var(--text-muted)] sm:text-xl sm:leading-[1.55]">
              Designs saved in this browser. Open one to keep editing.
            </p>

            {loadError ? (
              <p className="text-base leading-relaxed text-red-600">{loadError}</p>
            ) : null}

            {items === null ? (
              <p className="text-lg text-[var(--text-muted)]">Loading…</p>
            ) : items.length === 0 ? (
              <div className="max-w-xl">
                <p className="m-0 text-lg leading-[1.6] text-[var(--text-muted)]">
                  Nothing here yet. Start a canvas — it autosaves as you work.
                </p>
                <Link
                  to="/create"
                  className="mt-8 inline-flex min-h-12 items-center justify-center rounded-full bg-[var(--text)] px-10 py-3.5 text-base font-medium text-white no-underline hover:bg-[#262626] sm:min-h-14 sm:px-12 sm:py-4 sm:text-[1.0625rem]"
                >
                  Open editor
                </Link>
              </div>
            ) : (
              <ul className="m-0 grid list-none grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 sm:gap-7">
                {items.map((row) => (
                  <li key={row.id} className="min-w-0">
                    <Link
                      to="/create"
                      search={{ id: row.id }}
                      className="group flex h-full flex-col rounded-2xl border border-[var(--line)] bg-white/50 no-underline backdrop-blur-md transition-[border-color,background-color] duration-200 hover:border-black/[0.14] hover:bg-white/72 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--text)]"
                    >
                      <div className="p-2.5 sm:p-3">
                        <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-[var(--surface-subtle)] ring-1 ring-inset ring-black/[0.06]">
                          <FileGridPreview
                            persistId={row.id}
                            updatedAt={row.updatedAt}
                            className="absolute inset-0"
                          />
                        </div>
                      </div>
                      <div className="flex min-h-0 flex-1 flex-col gap-2 border-t border-black/[0.05] px-4 pb-4 pt-3">
                        <div className="truncate text-[15px] font-medium leading-snug tracking-[-0.01em] text-[var(--text)]">
                          {row.name}
                        </div>
                        <div className="text-[13px] leading-normal tabular-nums text-[var(--text-muted)]">
                          {row.artboardWidth} × {row.artboardHeight}px
                        </div>
                        <time
                          dateTime={new Date(row.updatedAt).toISOString()}
                          className="mt-auto text-[12px] tabular-nums text-[var(--text-subtle)]"
                        >
                          {formatUpdatedAt(row.updatedAt)}
                        </time>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
