export default function Brand({ onHome }: { onHome: () => void }) {
  return <a className="brand" href="/home" aria-label="Beatphone home" onClick={event => { event.preventDefault(); onHome() }}>
    beat<span>phone</span><span className="brand-dot">.</span>
  </a>
}
