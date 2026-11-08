import React from 'react'
import { Link } from 'react-router-dom'
import ThemeToggle from './ThemeToggle.jsx'
import './WorkspaceTopbar.css'

function WorkspaceTopbar({
  title,
  name,
  email,
  roleLabel,
  dashboardPath,
  helpPath,
  notificationsPath,
  settingsPath,
  isDark,
  onToggleTheme,
  onLogout,
}) {
  const initials = (name || email || roleLabel || 'A')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()

  return (
    <header className="workspace-topbar">
      <div className="workspace-topbar__breadcrumb">
        <strong>{title}</strong>
      </div>
      <div className="workspace-topbar__actions">
        <ThemeToggle isDark={isDark} onToggle={onToggleTheme} className="workspace-topbar__theme" />
        {notificationsPath && (
          <Link className="workspace-topbar__icon" to={notificationsPath} aria-label="Notifications">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0" />
            </svg>
          </Link>
        )}
        {helpPath && (
          <Link className="workspace-topbar__icon" to={helpPath} aria-label="Help and support">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.6 9a2.5 2.5 0 1 1 4.5 1.5c-.9 1.1-2.1 1.3-2.1 3m0 3h.01" />
            </svg>
          </Link>
        )}
        {settingsPath && (
          <Link className="workspace-topbar__icon" to={settingsPath} aria-label="Settings">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="m19.4 15 .1.1a1.8 1.8 0 1 1-2.5 2.5l-.1-.1a1.8 1.8 0 0 0-3 .9v.2a1.8 1.8 0 1 1-3.6 0v-.2a1.8 1.8 0 0 0-3-.9l-.1.1a1.8 1.8 0 1 1-2.5-2.5l.1-.1a1.8 1.8 0 0 0-.9-3h-.2a1.8 1.8 0 1 1 0-3.6h.2a1.8 1.8 0 0 0 .9-3l-.1-.1a1.8 1.8 0 1 1 2.5-2.5l.1.1a1.8 1.8 0 0 0 3-.9v-.2a1.8 1.8 0 1 1 3.6 0v.2a1.8 1.8 0 0 0 3 .9l.1-.1a1.8 1.8 0 1 1 2.5 2.5l-.1.1a1.8 1.8 0 0 0 .9 3h.2a1.8 1.8 0 1 1 0 3.6h-.2a1.8 1.8 0 0 0-.9 3Z" />
            </svg>
          </Link>
        )}
        <div className="workspace-topbar__account">
          <span className="workspace-topbar__avatar" aria-hidden="true">{initials}</span>
          <span className="workspace-topbar__identity">
            <strong>{name || roleLabel}</strong>
            <small>{roleLabel}</small>
          </span>
        </div>
        <button className="workspace-topbar__logout" type="button" onClick={onLogout}>Log out</button>
      </div>
    </header>
  )
}

export default WorkspaceTopbar
