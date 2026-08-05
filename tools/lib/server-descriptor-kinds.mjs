const SERVER_DESCRIPTOR_KINDS = Object.freeze({
  'auth-profile-registry.json': 'server-auth-profile-registry',
  'integrations.json': 'server-integrations',
  'data-spaces.json': 'server-data-spaces',
  'commerce.json': 'server-commerce',
  'integration-bindings.json': 'server-integration-bindings',
  'notification-policies.json': 'server-notification-policies',
});

const LOCAL_ONLY_DRAFT_DIRECTORY_NAMES = new Set([
  '.git',
  '.github',
  '_repos',
  'ai_notes',
  'findings',
  'errors-reports',
  'cvs_n_photos',
  'node_modules',
  'output',
  'reports',
  'logs',
  'devonly',
  '.superpowers',
  '.agent-coordination',
  '.draft-deploy',
  'tools',
]);

function normalizeDraftPathSegment(value) {
  const raw = String(value ?? '');
  let decoded;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new Error('invalid_draft_path');
  }
  if (!decoded || /%[0-9a-f]{2}/i.test(decoded) || /[\\/\u0000-\u001f\u007f]/.test(decoded)) {
    throw new Error('invalid_draft_path');
  }
  return decoded.toLowerCase();
}

function isLocalOnlyDraftDirectoryName(value) {
  return LOCAL_ONLY_DRAFT_DIRECTORY_NAMES.has(normalizeDraftPathSegment(value));
}

function inferServerDescriptorKind(domain, relativePath) {
  const normalized = String(relativePath ?? '').replace(/\\/g, '/');
  const rawSegments = normalized.split('/').filter(Boolean);
  let decodedSegments;
  try {
    decodedSegments = rawSegments.map(normalizeDraftPathSegment);
  } catch {
    throw new Error('invalid_server_descriptor_path');
  }
  const serverIndexes = decodedSegments
    .map((segment, index) => (segment === 'server' ? index : -1))
    .filter(index => index >= 0);
  if (serverIndexes.length === 0) return undefined;
  if (
    rawSegments.length !== 3
    || rawSegments[0] !== domain
    || rawSegments[1] !== 'server'
    || serverIndexes.length !== 1
    || serverIndexes[0] !== 1
  ) {
    throw new Error('invalid_server_descriptor_path');
  }
  const fileName = rawSegments[2];
  const kind = SERVER_DESCRIPTOR_KINDS[fileName];
  if (!kind) throw new Error('unknown_server_descriptor');
  return kind;
}

export {
  inferServerDescriptorKind,
  isLocalOnlyDraftDirectoryName,
  LOCAL_ONLY_DRAFT_DIRECTORY_NAMES,
  normalizeDraftPathSegment,
  SERVER_DESCRIPTOR_KINDS,
};
