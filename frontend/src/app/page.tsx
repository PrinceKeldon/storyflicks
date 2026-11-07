import Link from "next/link";

const shelves = [
  { eyebrow: "THE STORY EVERYONE IS TALKING ABOUT", title: "THE PRIEST", description: "Two lives. One secret. A confession that changes everything.", meta: "Episodic drama · Ongoing", action: "Explore the story" },
];

const navItems = ["Discover", "My Library", "Creator Studio"];

export default function DiscoverPage() {
  return (
    <main className="app-shell">
      <header className="topbar">
        <Link className="wordmark" href="/" aria-label="STORYFLICKS home">STORY<span>FLICKS</span><i>.</i></Link>
        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item, index) => index === 2
            ? <Link className="nav-link" href="/creator-studio" key={item}>{item}</Link>
            : <Link className={index === 0 ? "nav-link active" : "nav-link"} href={index === 0 ? "/" : "/library"} key={item}>{item}</Link>
          )}
        </nav>
        <div className="account-actions">
          <button className="icon-button" aria-label="Search"><span className="search-icon" /></button>
          <Link className="sign-in" href="/sign-in?next=/library">Sign in</Link>
          <Link className="join-button" href="/sign-in?mode=signup">Join free <span>↗</span></Link>
        </div>
      </header>

      <section className="welcome-row">
        <div>
          <p className="eyebrow">YOUR NEXT OBSESSION STARTS HERE</p>
          <h1>Stories worth <em>staying for.</em></h1>
        </div>
        <p className="welcome-note">A good story pulls you in.<br />A great one keeps you coming back.</p>
      </section>

      <section className="featured" aria-labelledby="featured-title">
        <div className="featured-copy">
          <div className="feature-kicker"><span className="live-dot" /> FEATURED STORY</div>
          <p className="feature-overline">AN ORIGINAL STORYFLICKS SERIES</p>
          <h2 id="featured-title">THE<br /><span>PRIEST</span></h2>
          <p className="feature-tagline">{shelves[0].description}</p>
          <p className="feature-meta">DRAMA <b>·</b> ONGOING <b>·</b> EPISODIC</p>
          <div className="feature-actions">
            <Link className="primary-button" href="/stories/the-priest">Explore the story <span>↗</span></Link>
            <Link className="text-button" href="/stories/the-priest">View episode guide <span>→</span></Link>
          </div>
        </div>
        <div className="feature-art" role="img" aria-label="Typographic artwork for THE PRIEST">
          <div className="art-grain" />
          <div className="art-cross" />
          <div className="art-caption">A STORY ABOUT<br />FAITH, DESIRE &amp; SECRETS</div>
          <div className="art-title">THE<br /><strong>PRIEST</strong></div>
          <div className="art-index">SF ORIGINAL&nbsp;&nbsp; / &nbsp;&nbsp;001</div>
        </div>
        <div className="feature-index"><span>01</span><i /> 01</div>
      </section>

      <section className="shelf-section">
        <div className="section-heading">
          <div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><h2>Keep the story going<span>.</span></h2></div>
          <Link href="/library" className="subtle-link">Your library <span>→</span></Link>
        </div>
        <div className="empty-shelf">
          <div className="empty-mark">↗</div>
          <div><h3>Your next chapter is waiting.</h3><p>Your reading progress, saved stories and contributions live together in My Library.</p></div>
          <Link href="/library" className="outline-button">Open My Library <span>↗</span></Link>
        </div>
      </section>

      <section className="browse-row">
        <div><p className="eyebrow">FIND YOUR KIND OF STORY</p><h2>What are you in the mood for?</h2></div>
        <div className="genre-list"><a href="#drama">Drama <span>↗</span></a><a href="#thriller">Thriller <span>↗</span></a><a href="#romance">Romance <span>↗</span></a><a href="#mystery">Mystery <span>↗</span></a></div>
      </section>

      <footer className="footer"><Link className="wordmark" href="/">STORY<span>FLICKS</span><i>.</i></Link><p>Stories worth staying for.</p><span>© 2026 STORYFLICKS</span></footer>
    </main>
  );
}