import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: Landing })

function Landing() {
  return (
    <main className="flex min-h-[100dvh] flex-col justify-center px-6 py-20 sm:px-10">
      <div className="page-wrap rise-in">
        <h1 className="display-title mb-6 text-5xl font-medium leading-[1.05] tracking-tight text-[var(--text)] sm:text-7xl sm:leading-[1.02]">
          Design in the browser, openly.
        </h1>
        <p className="mb-12 max-w-lg text-lg leading-relaxed text-[var(--text-muted)] sm:text-xl">
          Avnac is a simple, open-source canvas for layouts and graphics — no
          account, start from blank and export when you are done.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <Link
            to="/create"
            className="inline-flex items-center justify-center rounded-full bg-[var(--text)] px-7 py-3 text-sm font-medium text-white no-underline hover:bg-[#262626] hover:text-white"
          >
            Open editor
          </Link>
          <a
            href="https://github.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-[var(--text-muted)] underline decoration-[var(--border)] underline-offset-4 hover:text-[var(--text)]"
          >
            GitHub
          </a>
        </div>
      </div>
    </main>
  )
}
