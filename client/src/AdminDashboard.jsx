import React from 'react'

function AdminDashboard({ email, onLogout }) {
  return (
    <main className="dashboard-landing">
      <section className="dashboard-card" aria-labelledby="admin-dashboard-title">
        <a className="brand" href="#" aria-label="aiHustle home">
          <img src="/logo.png" alt="aiHustle" />
        </a>
        <p className="dashboard-eyebrow">ADMIN ACCOUNT</p>
        <h1 id="admin-dashboard-title">Admin Dashboard</h1>
        <p>Welcome, Admin!</p>
        <p className="admin-dashboard__success" role="status">
          Admin login successful
        </p>
        <div className="admin-dashboard__account">
          <span>Signed in as</span>
          <strong>{email}</strong>
        </div>
        <button className="dashboard-button admin-dashboard__logout" type="button" onClick={onLogout}>
          Logout
        </button>
      </section>
    </main>
  )
}

export default AdminDashboard
