export function getUser() {
  try {
    const u = localStorage.getItem('pdi_user')
    return u ? JSON.parse(u) : null
  } catch { return null }
}

export function getToken() {
  return localStorage.getItem('pdi_token') || null
}

export function setAuth(token, user) {
  localStorage.setItem('pdi_token', token)
  localStorage.setItem('pdi_user', JSON.stringify(user))
}

export function clearAuth() {
  localStorage.removeItem('pdi_token')
  localStorage.removeItem('pdi_user')
}

export function isAuthenticated() {
  return !!getToken()
}
