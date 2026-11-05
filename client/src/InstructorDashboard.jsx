import React from 'react'

function InstructorDashboard({ fullName, email, onLogout }) {
  return (
    <main className="dashboard-landing">
      <section className="dashboard-card" aria-labelledby="instructor-dashboard-title">
        <a className="brand" href="#" aria-label="aiHustle home">
          <img src="/logo.png" alt="aiHustle" />
        </a>
        <p className="dashboard-eyebrow">INSTRUCTOR ACCOUNT</p>
        <h1 id="instructor-dashboard-title">Instructor Dashboard</h1>
        <p>Welcome, Instructor!</p>
        <p className="instructor-dashboard__success" role="status">
          Instructor login successful
        </p>
        <dl className="instructor-dashboard__details">
          <div>
            <dt>Full name</dt>
            <dd>{fullName}</dd>
          </div>
          <div>
            <dt>Email</dt>
            <dd>{email}</dd>
          </div>
          <div>
            <dt>Account status</dt>
            <dd>Active</dd>
          </div>
        </dl>
        <button className="dashboard-button instructor-dashboard__logout" type="button" onClick={onLogout}>
          Logout
        </button>
      </section>
    </main>
  )
}

export default InstructorDashboard
