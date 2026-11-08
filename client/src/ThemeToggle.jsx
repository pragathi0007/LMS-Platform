import React from 'react'

function ThemeToggle({ isDark, onToggle, className = '' }) {
  return (
    <button
      className={`theme-toggle ${className}`.trim()}
      type="button"
      aria-label={`Switch to ${isDark ? 'light' : 'dark'} theme`}
      aria-pressed={isDark}
      onClick={onToggle}
    >
      {isDark ? (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="10" cy="10" r="3.5" />
          <path d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2m14-5.8-1.4 1.4M5.6 14.4l-1.4 1.4m11.6 0-1.4-1.4M5.6 5.6 4.2 4.2" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="M16.8 12.2A7.3 7.3 0 0 1 7.8 3.2a7.3 7.3 0 1 0 9 9Z" />
        </svg>
      )}
      <span className="theme-toggle__label">{isDark ? 'Light mode' : 'Dark mode'}</span>
    </button>
  )
}

export default ThemeToggle
