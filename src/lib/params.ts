export function decodeParam(v: string) {
  try {
    return v.includes("%") ? decodeURIComponent(v) : v;
  } catch {
    return v;
  }
}
