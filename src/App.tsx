export default function App() {
  return (
    <main className="welcome">
      <p className="eyebrow">A party game of musical misunderstandings</p>
      <h1>Beat <span>Telephone.</span></h1>
      <p className="intro">
        Start with a silly idea. Turn it into a beat. Pass it on and hear
        how wonderfully wrong it goes.
      </p>
      <ol className="steps" aria-label="How the game works">
        <li><span aria-hidden="true">01</span> Write an idea</li>
        <li><span aria-hidden="true">02</span> Make some music</li>
        <li><span aria-hidden="true">03</span> Pass it on</li>
      </ol>
      <p className="status">Under construction. The first beat is coming soon.</p>
    </main>
  )
}
