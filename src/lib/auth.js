export const appUrl = ((import.meta.env || {}).VITE_APP_URL || window.location.origin).replace(/\/$/, '');
export const minimumLength = Number((import.meta.env || {}).VITE_PASSWORD_MIN_LENGTH || 8);
export const characterRules = (import.meta.env || {}).VITE_PASSWORD_REQUIRED_CHARACTERS || '';
export function passwordError(password, confirmation) {
  if (password.length < minimumLength) return `Use at least ${minimumLength} characters.`;
  const rules = { lower: /[a-z]/, upper: /[A-Z]/, digit: /[0-9]/, symbol: /[^a-zA-Z0-9]/ };
  for (const rule of characterRules.split(',').filter(Boolean)) {
    if (rules[rule] && !rules[rule].test(password)) return `Password must include a ${rule} character.`;
  }
  return password !== confirmation ? 'Passwords must match.' : '';
}
export function recoveryRoute(location) {
  return location.pathname.endsWith('/reset-password') || new URLSearchParams(location.hash.slice(1)).get('type') === 'recovery';
}
