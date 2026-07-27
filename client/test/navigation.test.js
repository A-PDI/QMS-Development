/**
 * Sidebar navigation and admin-only access.
 *
 * Covers requirement scenarios 4–5: admin users can see and reach Injector
 * Tests; non-admin users cannot see it and are blocked from the route.
 */

import test from 'node:test'
import assert from 'node:assert'

import {
  NAV_ITEMS,
  isAdminUser,
  isNavVisible,
  visibleNavItems,
  canAccessRoute,
  allowedTabsFor,
} from '../src/lib/nav.js'

const admin = { id: 'a', name: 'Admin', role: 'admin' }
const qcManager = { id: 'q', name: 'QC', role: 'qc_manager' }
const inspector = { id: 'i', name: 'Inspector', role: 'inspector' }
const restricted = { id: 'r', name: 'Limited', role: 'inspector', permissions: JSON.stringify({ tabs: ['dashboard'] }) }

const injectorItem = NAV_ITEMS.find((i) => i.to === '/injector-tests')

test('Injector Tests sits directly below Admin in the sidebar', () => {
  const labels = NAV_ITEMS.map((i) => i.label)
  const adminIdx = labels.indexOf('Admin')
  assert.ok(adminIdx >= 0, 'Admin item exists')
  assert.strictEqual(labels[adminIdx + 1], 'Injector Tests')
})

test('the Injector Tests item is admin-only', () => {
  assert.ok(injectorItem, 'nav item exists')
  assert.strictEqual(injectorItem.adminOnly, true)
})

test('admin users see and can access Injector Tests', () => {
  for (const user of [admin, qcManager]) {
    assert.ok(isAdminUser(user))
    assert.ok(isNavVisible(injectorItem, user), `${user.role} should see the item`)
    assert.ok(visibleNavItems(user).some((i) => i.to === '/injector-tests'))
    assert.ok(canAccessRoute('/injector-tests', user))
  }
})

test('non-admin users cannot see or access Injector Tests', () => {
  for (const user of [inspector, restricted, null, undefined]) {
    assert.ok(!isAdminUser(user))
    assert.strictEqual(isNavVisible(injectorItem, user), false)
    assert.ok(!visibleNavItems(user).some((i) => i.to === '/injector-tests'))
    assert.strictEqual(canAccessRoute('/injector-tests', user), false, 'direct navigation is blocked')
  }
})

test('moving the item did not change the rest of the navigation rules', () => {
  // Admin-only pages stay admin-only.
  assert.strictEqual(canAccessRoute('/admin', inspector), false)
  assert.strictEqual(canAccessRoute('/reports', inspector), false)
  assert.strictEqual(canAccessRoute('/admin', admin), true)
  // "My Inspections" is still hidden from admins and visible to inspectors.
  assert.ok(!visibleNavItems(admin).some((i) => i.to === '/my-inspections'))
  assert.ok(visibleNavItems(inspector).some((i) => i.to === '/my-inspections'))
  // Per-user page permissions still restrict non-admins.
  assert.deepStrictEqual(allowedTabsFor(restricted), ['dashboard'])
  assert.deepStrictEqual(visibleNavItems(restricted).map((i) => i.to), ['/'])
  // Admins are never restricted by per-user permissions.
  assert.strictEqual(allowedTabsFor({ ...admin, permissions: JSON.stringify({ tabs: ['dashboard'] }) }), null)
})

test('malformed permissions do not hide everything', () => {
  const broken = { role: 'inspector', permissions: '{not json' }
  assert.strictEqual(allowedTabsFor(broken), null)
  assert.ok(visibleNavItems(broken).length > 1)
})
