import React, { useEffect, useState } from 'react'
import './StudentDashboard.css'

const navigation = [
  { label: 'Dashboard', icon: 'grid', target: 'student-overview' },
  { label: 'My Courses', icon: 'book', target: 'student-courses' },
  { label: 'Assignments', icon: 'check', target: 'student-assignments' },
  { label: 'Grades & Results', icon: 'chart', target: 'student-grades' },
  { label: 'Learning Resources', icon: 'folder', target: 'student-resources' },
  { label: 'Messages', icon: 'message', target: 'student-messages' },
  { label: 'Certificates', icon: 'award', target: 'student-certificates' },
  { label: 'My Profile', icon: 'user', target: 'student-profile' },
  { label: 'Settings', icon: 'settings', target: 'student-settings' },
]

const stats = [
  { label: 'Enrolled courses', icon: 'book', tone: 'gold' },
  { label: 'Pending assignments', icon: 'check', tone: 'peach' },
  { label: 'Completed courses', icon: 'award', tone: 'mint' },
  { label: 'Learning streak', icon: 'spark', tone: 'blue' },
]

const tools = [
  { title: 'Grades & Results', description: 'Your assessment results will appear here.', icon: 'chart', id: 'student-grades' },
  { title: 'Learning Resources', description: 'Resources shared with your courses will appear here.', icon: 'folder', id: 'student-resources' },
  { title: 'Messages', description: 'Course conversations and messages will appear here.', icon: 'message', id: 'student-messages' },
  { title: 'Certificates', description: 'Certificates you earn will appear here.', icon: 'award', id: 'student-certificates' },
  { title: 'My Profile', description: 'Your account details are verified securely from the LMS.', icon: 'user', id: 'student-profile' },
  { title: 'Settings', description: 'Account preferences will be available here.', icon: 'settings', id: 'student-settings' },
]

function Icon({ name, size = 19 }) {
  const paths = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 5.5v16M8 7h8m-8 4h8" /></>,
    check: <><rect x="4" y="4" width="16" height="17" rx="2" /><path d="M8 3v3m8-3v3M4 9h16m-11 5 2 2 4-4" /></>,
    chart: <><path d="M4 19V5m0 14h17" /><path d="m7 15 4-4 3 2 5-6m-4 0h4v4" /></>,
    folder: <><path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H10l2 2h6.5A2.5 2.5 0 0 1 21 8.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" /><path d="M3 9h18" /></>,
    message: <><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5 8 8 0 0 1-3.5-.8L4 20l1.5-4A7.5 7.5 0 1 1 20 11.5Z" /><path d="M8 11h.01M12 11h.01M16 11h.01" /></>,
    award: <><circle cx="12" cy="8" r="5" /><path d="m8.5 12-1 9 4.5-2.5 4.5 2.5-1-9" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.8-.6a8 8 0 0 1-1.7 1l-.3 1.9h-2.8l-.3-1.9a8 8 0 0 1-1.7-1l-1.8.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.8.6a8 8 0 0 1 1.7-1l.3-1.9h2.8l.3 1.9a8 8 0 0 1 1.7 1l1.8-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" transform="translate(-1 -1)" /></>,
    spark: <><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z" /><path d="m19 15 .8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 4.5 4.5" /></>,
    bell: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-.9 1.1-2.1 1.3-2.1 3m0 3h.01" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
  }

  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] || paths.grid}
    </svg>
  )
}

function LearningIllustration() {
  return (
    <svg className="student-welcome__illustration" viewBox="0 0 240 172" fill="none" aria-hidden="true">
      <circle cx="154" cy="83" r="67" fill="#F7EBC8" />
      <circle cx="154" cy="83" r="52" fill="#E4F0E7" />
      <path d="M104 120h99" stroke="#AFC6B8" strokeWidth="2" strokeLinecap="round" />
      <path d="M126 119V74c0-4 3-7 7-7h42c4 0 7 3 7 7v45" fill="#FFFDF7" stroke="#D8D6C9" strokeWidth="2" />
      <path d="M147 67v52m-21-38h21m7 0h28m-28 12h28m-28 12h19" stroke="#7FA99A" strokeWidth="2" strokeLinecap="round" />
      <path d="M108 121c11-15 24-19 39-12 12 6 19 5 28 1" stroke="#D6B35B" strokeWidth="3" strokeLinecap="round" />
      <circle cx="101" cy="51" r="8" fill="#E8C460" />
      <path d="m197 38 3 7 7 3-7 3-3 7-3-7-7-3 7-3z" fill="#6BA99A" />
      <path d="M57 121h44m-35-9v9m26-9v9" stroke="#C9C7BA" strokeWidth="2" strokeLinecap="round" />
      <path d="M65 107h28l-3-30a11 11 0 0 0-22 0z" fill="#EBD789" />
      <path d="M72 91h14m-12 8h10" stroke="#A78A43" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function EmptyState({ icon, title, description }) {
  return (
    <div className="student-empty">
      <span className="student-empty__icon"><Icon name={icon} size={22} /></span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}

function StudentDashboard({ user, loading, error, onRetry, onLogout }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [activeTarget, setActiveTarget] = useState(() => {
    const target = window.location.hash.slice(1)
    return navigation.some((item) => item.target === target) ? target : 'student-overview'
  })
  const firstName = user?.fullName?.trim().split(/\s+/)[0] || 'Student'
  const initials = user?.fullName
    ? user.fullName.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()
    : 'S'

  useEffect(() => {
    function syncActiveTarget() {
      const target = window.location.hash.slice(1)
      setActiveTarget(navigation.some((item) => item.target === target) ? target : 'student-overview')
    }

    window.addEventListener('hashchange', syncActiveTarget)
    window.addEventListener('popstate', syncActiveTarget)
    return () => {
      window.removeEventListener('hashchange', syncActiveTarget)
      window.removeEventListener('popstate', syncActiveTarget)
    }
  }, [])

  function navigateTo(target) {
    setSidebarOpen(false)
    setActiveTarget(target)
    if (window.location.hash !== `#${target}`) {
      window.history.pushState(null, '', `#${target}`)
    }
    document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="student-dashboard">
      {sidebarOpen && (
        <button
          className="student-dashboard__scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <aside className={`student-sidebar${sidebarOpen ? ' is-open' : ''}`} aria-label="Student navigation">
        <a className="student-sidebar__brand" href="/" aria-label="Morrow Learning home">
          <img src="/logo.png" alt="Morrow Learning" />
          <span>LEARN. GROW. BECOME.</span>
        </a>
        <p className="student-sidebar__label">LEARNING SPACE</p>
        <nav className="student-sidebar__nav">
          {navigation.map((item) => (
            <a
              key={item.label}
              href={`#${item.target}`}
              className={`student-sidebar__link${item.target === activeTarget ? ' is-active' : ''}`}
              aria-current={item.target === activeTarget ? 'page' : undefined}
              onClick={(event) => {
                event.preventDefault()
                navigateTo(item.target)
              }}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {item.label === 'Messages' && <span className="student-sidebar__soon">Soon</span>}
            </a>
          ))}
        </nav>
        <div className="student-sidebar__bottom">
          <div className="student-sidebar__profile">
            <span className="student-avatar">{initials}</span>
            <span className="student-sidebar__identity">
              <strong>{user?.fullName || 'Your account'}</strong>
              <small>Student account</small>
            </span>
          </div>
          <button className="student-sidebar__logout" type="button" onClick={onLogout}>
            <Icon name="logout" size={17} /> Log out
          </button>
        </div>
      </aside>

      <main className="student-main" id="student-overview">
        <header className="student-topbar">
          <button
            className="student-icon-button student-menu-toggle"
            type="button"
            aria-label="Open navigation"
            aria-expanded={sidebarOpen}
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <div className="student-breadcrumb"><span>Morrow Learning</span><b>/</b><strong>Dashboard</strong></div>
          <label className="student-search">
            <Icon name="search" size={18} />
            <input type="search" placeholder="Search courses, lessons, resources..." aria-label="Search courses, lessons, resources" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="student-topbar__actions">
            <button
              className="student-icon-button"
              type="button"
              aria-label="Announcements"
              onClick={() => navigateTo('student-announcements')}
            >
              <Icon name="bell" />
            </button>
            <button
              className="student-icon-button"
              type="button"
              aria-label="Help and study companion"
              onClick={() => navigateTo('student-ai')}
            >
              <Icon name="help" />
            </button>
            <div className="student-profile-menu">
              <button
                className="student-profile-trigger"
                type="button"
                aria-expanded={profileOpen}
                onClick={() => setProfileOpen((open) => !open)}
              >
                <span className="student-avatar">{initials}</span>
                <span className="student-profile-trigger__copy">
                  <strong>{user?.fullName || 'Student'}</strong><small>Student</small>
                </span>
                <span className="student-profile-trigger__chevron">⌄</span>
              </button>
              {profileOpen && (
                <div className="student-profile-dropdown">
                  <span>{user?.email || 'Account details'}</span>
                  <button type="button" onClick={onLogout}><Icon name="logout" size={16} /> Log out</button>
                </div>
              )}
            </div>
          </div>
        </header>

        <div className="student-content">
          {loading ? (
            <section className="student-state-card" aria-live="polite">
              <span className="student-loader" />
              <h1>Preparing your learning space</h1>
              <p>Verifying your student account...</p>
            </section>
          ) : error ? (
            <section className="student-state-card student-state-card--error" role="alert">
              <span className="student-state-card__icon"><Icon name="lock" size={22} /></span>
              <h1>We couldn’t verify your session</h1>
              <p>{error}</p>
              <div><button className="student-button" type="button" onClick={onRetry}>Try again</button>
                <button className="student-button student-button--quiet" type="button" onClick={onLogout}>Return to login</button></div>
            </section>
          ) : (
            <>
              <section className="student-welcome">
                <div className="student-welcome__copy">
                  <span className="student-eyebrow"><span /> YOUR LEARNING SPACE</span>
                  <h1>Welcome back, {firstName}!</h1>
                  <p>Continue learning, achieve your goals and track your progress.</p>
                  <span className="student-welcome__today"><Icon name="spark" size={16} /> A little progress adds up.</span>
                </div>
                <LearningIllustration />
              </section>

              <section className="student-stats" aria-label="Student statistics">
                {stats.map((stat) => (
                  <article className="student-stat" key={stat.label}>
                    <span className={`student-stat__icon is-${stat.tone}`}><Icon name={stat.icon} size={19} /></span>
                    <span className="student-stat__label">{stat.label}</span>
                    <strong className="student-stat__value" aria-label="Data unavailable">—</strong>
                    <small>Not yet connected to LMS data</small>
                  </article>
                ))}
              </section>

              <section className="student-panel student-progress-panel" aria-labelledby="student-progress-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">YOUR JOURNEY</span><h2 id="student-progress-title">My learning progress</h2></div>
                  <span className="student-data-note">Progress tracking unavailable</span>
                </div>
                <div className="student-progress-layout">
                  <div className="student-donut" role="img" aria-label="Overall learning completion data unavailable">
                    <div><strong>—</strong><span>OVERALL</span></div>
                  </div>
                  <div className="student-lesson-counts">
                    {[
                      ['Completed lessons', 'mint'],
                      ['Lessons in progress', 'gold'],
                      ['Lessons not started', 'gray'],
                    ].map(([label, tone]) => (
                      <div className="student-lesson-count" key={label}>
                        <span className={`student-lesson-count__dot is-${tone}`} />
                        <span>{label}</span>
                        <strong>—</strong>
                      </div>
                    ))}
                    <p>Lesson progress will appear once course tracking is connected.</p>
                  </div>
                </div>
              </section>

              <section className="student-panel" id="student-courses" aria-labelledby="student-courses-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">PICK UP WHERE YOU LEFT OFF</span><h2 id="student-courses-title">Continue learning</h2></div>
                  <span className="student-section-link student-section-link--muted">Courses unavailable</span>
                </div>
                <EmptyState icon="book" title="Your courses will appear here" description="Course enrollment and lesson progress aren’t available from the current LMS API yet." />
              </section>

              <div className="student-two-column">
                <section className="student-panel" id="student-assignments" aria-labelledby="student-assignments-title">
                  <div className="student-section-heading">
                    <div><span className="student-eyebrow">STAY ON TRACK</span><h2 id="student-assignments-title">Upcoming assignments</h2></div>
                    <a className="student-section-link student-section-link--muted" href="#student-assignments">View all</a>
                  </div>
                  <EmptyState icon="check" title="No assignment data available" description="Assignments and due dates aren’t connected to this account yet." />
                </section>
                <section className="student-panel student-announcements" id="student-announcements" aria-labelledby="student-announcements-title">
                  <div className="student-section-heading">
                    <div><span className="student-eyebrow">FROM YOUR LEARNING COMMUNITY</span><h2 id="student-announcements-title">Announcements</h2></div>
                    <span className="student-section-link student-section-link--muted">Updates</span>
                  </div>
                  <EmptyState icon="bell" title="Announcement data isn’t connected yet" description="Instructor and administrator announcements will appear here once the LMS provides them." />
                </section>
              </div>

              <div className="student-two-column student-lower-grid">
                <section className="student-panel student-weekly-goal" aria-labelledby="student-goal-title">
                  <span className="student-eyebrow">A STEADY RHYTHM</span>
                  <h2 id="student-goal-title">Weekly learning goal</h2>
                  <div className="student-goal-values"><strong>— <small>hrs</small></strong><span>of — hrs this week</span></div>
                  <div className="student-progress-track"><span /></div>
                  <p>Learning time and weekly goal tracking aren’t connected yet.</p>
                </section>
                <section className="student-panel student-ai-card" id="student-ai" aria-labelledby="student-ai-title">
                  <span className="student-ai-card__icon"><Icon name="spark" size={20} /></span>
                  <span className="student-eyebrow">A HELPFUL STUDY SPACE</span>
                  <h2 id="student-ai-title">AI Study Companion</h2>
                  <p>Topic explanations, lesson summaries and practice questions are planned for a future release.</p>
                  <span className="student-ai-card__status">Not connected to an AI service</span>
                </section>
              </div>

              <section className="student-tools" aria-labelledby="student-tools-title">
                <div className="student-section-heading">
                  <div><span className="student-eyebrow">MORE FOR YOUR JOURNEY</span><h2 id="student-tools-title">Student tools</h2></div>
                </div>
                <div className="student-tools-grid">
                  {tools.map((tool) => (
                    <article className="student-tool-card" id={tool.id} key={tool.id}>
                      <span className="student-tool-card__icon"><Icon name={tool.icon} size={19} /></span>
                      <h3>{tool.title}</h3>
                      <p>{tool.description}</p>
                      <span className="student-tool-card__status">Coming as LMS features are connected</span>
                    </article>
                  ))}
                </div>
              </section>
              <footer className="student-footer"><span>Made for curious minds</span><span>Keep going, one lesson at a time.</span></footer>
            </>
          )}
        </div>
      </main>
    </div>
  )
}

export default StudentDashboard
