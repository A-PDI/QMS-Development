/**
 * Main sidebar navigation definition and visibility rules.
 *
 * Kept out of the Sidebar component (which owns the icons and markup) so the
 * same rules drive both the menu and the route guards — and so they can be
 * unit-tested without rendering React.
 *
 * Visibility rules, in order:
 *   adminOnly    — admins only (Reports, Admin, Injector Tests)
 *   hideForAdmin — hidden from admins (My Inspections)
 *   permKey      — per-user page permissions for non-admin users
 */

export const NAV_ITEMS = [
  { to: '/',                icon: 'dashboard',     label: 'Dashboard',       end: true, permKey: 'dashboard' },
  { to: '/my-inspections',  icon: 'user',          label: 'My Inspections',             permKey: 'my_inspections', hideForAdmin: true },
  { to: '/inspections',     icon: 'clipboard',     label: 'Inspections',                permKey: 'inspections' },
  { to: '/inspections/new', icon: 'plus',          label: 'New Inspection', accent: true, permKey: 'new_inspection' },
  { to: '/ncrs',            icon: 'alert',         label: 'NCRs',                       permKey: 'ncrs' },
  { to: '/quality-alerts',  icon: 'bell',          label: 'Quality Alerts', alertKey: 'qualityAlerts', permKey: 'quality_alerts' },
  { to: '/drawings',        icon: 'drawing',       label: 'Drawings',                   permKey: 'drawings' },
  { to: '/reports',         icon: 'chart',         label: 'Reports',        adminOnly: true },
  { to: '/admin',           icon: 'settings',      label: 'Admin',          adminOnly: true },
  // Injector Tests sits directly below Admin and is restricted to the ADMIN
  // role alone (not qc_manager, unlike the other admin pages) — here, on the
  // route (see App.jsx) and on the API (routes/injector-tests.js).
  { to: '/injector-tests',  icon: 'gauge',         label: 'Injector Tests', adminOnly: true, roles: ['admin'] },
]

/**
 * Roles treated as "admin" throughout the app. Matches the server's
 * ADMIN_ROLES in routes/injector-tests.js.
 */
export const ADMIN_ROLES = ['admin', 'qc_manager']

export function isAdminUser(user) {
  return !!user && ADMIN_ROLES.includes(user.role)
}

/**
 * The per-user page allow-list, or null when the user has no restrictions.
 * Admins are never restricted.
 */
export function allowedTabsFor(user) {
  if (!user || isAdminUser(user)) return null
  const raw = user.permissions
  if (!raw) return null
  try {
    const perms = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Array.isArray(perms?.tabs) ? perms.tabs : null
  } catch (_) {
    return null
  }
}

/** Should this nav item be shown to this user? */
export function isNavVisible(item, user) {
  if (!item) return false
  // An item may name the exact roles allowed (Injector Tests: admin only);
  // otherwise adminOnly means the usual admin group.
  if (Array.isArray(item.roles)) return !!user && item.roles.includes(user.role)
  if (item.adminOnly) return isAdminUser(user)
  if (item.hideForAdmin && isAdminUser(user)) return false
  const allowedTabs = allowedTabsFor(user)
  if (allowedTabs && item.permKey && !allowedTabs.includes(item.permKey)) return false
  return true
}

/** The nav items this user may see, in order. */
export function visibleNavItems(user, items = NAV_ITEMS) {
  return items.filter((item) => isNavVisible(item, user))
}

/** True when the user may open the given route path. */
export function canAccessRoute(path, user) {
  const item = NAV_ITEMS.find((i) => i.to === path)
  if (!item) return true
  return isNavVisible(item, user)
}
