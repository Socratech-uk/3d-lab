/** File identity shared by Designer and Explorer. Validate; never silently
 * rename or strip characters from an authored project basename. */
export function validSolProjectFilename(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,150}\.solmodel\.json$/.test(value) || value.includes('..')) return false;
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value.split('.', 1)[0].trimEnd());
}

/** Component folders are a separate identity field. Ordinary game defaults
 * remain basenames at the user-model root; no path is accepted as a filename. */
export function validSolProjectDirectory(value) {
  if (value === '') return true;
  if (typeof value !== 'string') return false;
  const parts = value.split('/');
  if (parts[0] !== 'components' || parts.length > 4) return false;
  return parts.every(part => /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(part)
    && part.trimEnd() === part
    && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(part));
}
