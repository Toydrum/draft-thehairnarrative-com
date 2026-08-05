const SECRET_PATTERN_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'aws-access-key-id', regex: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/, grep: '\\b(?:AKIA|ASIA)[A-Z0-9]{16}\\b' }),
  Object.freeze({ id: 'private-key-block', regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/, grep: '-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----' }),
  Object.freeze({ id: 'github-token', regex: /\bgh[pousr]_[A-Za-z0-9_]{36,255}\b/, grep: '\\bgh[pousr]_[A-Za-z0-9_]{36,255}\\b' }),
  Object.freeze({ id: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/, grep: '\\bAIza[0-9A-Za-z_-]{35}\\b' }),
  Object.freeze({ id: 'stripe-secret-key', regex: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z_-]{4,}\b/, grep: '\\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z_-]{4,}\\b' }),
  Object.freeze({ id: 'stripe-webhook-secret', regex: /\bwhsec_[0-9A-Za-z_-]{4,}\b/, grep: '\\bwhsec_[0-9A-Za-z_-]{4,}\\b' }),
  Object.freeze({ id: 'slack-token', regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/, grep: '\\bxox[baprs]-[A-Za-z0-9-]{10,}\\b' }),
  Object.freeze({
    id: 'signed-url-query',
    regex: /[?&](?:X-Amz-(?:Algorithm|Credential|Date|Expires|SignedHeaders|Signature|Security-Token)|X-Goog-(?:Algorithm|Credential|Date|Expires|SignedHeaders|Signature)|AWSAccessKeyId|GoogleAccessId|Signature|Policy|Key-Pair-Id|sig)=/i,
    grep: '[?&](?:X-Amz-(?:Algorithm|Credential|Date|Expires|SignedHeaders|Signature|Security-Token)|X-Goog-(?:Algorithm|Credential|Date|Expires|SignedHeaders|Signature)|AWSAccessKeyId|GoogleAccessId|Signature|Policy|Key-Pair-Id|sig)=',
  }),
  Object.freeze({
    id: 'generic-secret-assignment',
    regex: /\b(?:api[_-]?key|secret|token|password|passwd|pwd|client_secret|private_key|access_token|refresh_token)\b\s*[:=]\s*["']?[^"'`\s]{8,}/i,
    grep: "\\b(?:api[_-]?key|secret|token|password|passwd|pwd|client_secret|private_key|access_token|refresh_token)\\b\\s*[:=]\\s*[\"']?[^\"'`\\s]{8,}",
  }),
]);

const REVIEW_PATTERN_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'email-address', regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, grep: '\\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}\\b' }),
  Object.freeze({ id: 'phone-or-whatsapp', regex: /(?:wa\.me\/\d{8,}|\+\d[\d\s().-]{7,}\d)/i, grep: '(?:wa\\.me/\\d{8,}|\\+\\d[\\d\\s().-]{7,}\\d)' }),
  Object.freeze({ id: 'identity-keyword', regex: /\b(?:CURP|RFC|NSS|SSN|passport|pasaporte|INE|credencial(?:es)?|identificacion|identificación)\b/i, grep: '\\b(?:CURP|RFC|NSS|SSN|passport|pasaporte|INE|credencial(?:es)?|identificacion|identificación)\\b' }),
]);

const SECRET_FIELD_NAME_PATTERN = /^(?:api[-_]?key|secret|token|password|passwd|pwd|client[-_]?secret|private[-_]?key|access[-_]?token|refresh[-_]?token)$/i;
const PII_FIELD_NAME_PATTERN = /^(?:email|mail|phone|telefono|teléfono|whatsapp|address|direccion|dirección|rfc|curp|nss|ssn|passport|pasaporte|ine)$/i;
const PROVIDER_RESOURCE_ID_PATTERN = /^(?:acct|cus|price|prod|sub|si|cs|pi|pm|src|ch|in|evt|seti|sess)_[A-Za-z0-9]/i;
const OPAQUE_SECRET_REFERENCE_PATTERN = /^(?!.*\/\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?:(?:\/)?(?:[A-Za-z0-9_.+=@-]+\/)+[A-Za-z0-9_.+=@-]+|arn:(?:aws|aws-us-gov|aws-cn):(?:ssm:[a-z0-9-]+:\d{12}:parameter\/|secretsmanager:[a-z0-9-]+:\d{12}:secret\x3a)[A-Za-z0-9_.+=@\/-]+)$/;

function isOpaqueSecretReference(value) {
  if (typeof value !== 'string' || !OPAQUE_SECRET_REFERENCE_PATTERN.test(value)) return false;
  const patterns = value.startsWith('arn:')
    ? SECRET_PATTERN_DEFINITIONS.filter(rule => rule.id !== 'generic-secret-assignment')
    : SECRET_PATTERN_DEFINITIONS;
  return !patterns.some(rule => rule.regex.test(value));
}

export {
  OPAQUE_SECRET_REFERENCE_PATTERN,
  PII_FIELD_NAME_PATTERN,
  PROVIDER_RESOURCE_ID_PATTERN,
  REVIEW_PATTERN_DEFINITIONS,
  SECRET_FIELD_NAME_PATTERN,
  SECRET_PATTERN_DEFINITIONS,
  isOpaqueSecretReference,
};
