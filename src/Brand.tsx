export default function Brand({ onHome }: { onHome: () => void }) {
  return <a className="brand" href="/home" aria-label="Beat Telephone home" onClick={event => { event.preventDefault(); onHome() }}>
    beat<span>telephone</span><span className="brand-dot">.</span>
  </a>
}
