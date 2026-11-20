import dns from 'node:dns'
import { config } from './env.js'

/**
 * Extracts the hostname from a mongodb+srv:// connection URI.
 * @param {string} uri
 * @returns {string|null}
 */
export function extractSrvHostname(uri) {
  if (!uri || typeof uri !== 'string' || !uri.startsWith('mongodb+srv://')) {
    return null
  }
  try {
    const parsed = new URL(uri)
    if (parsed.hostname) return parsed.hostname
  } catch {
    // Fallback regex if URI contains unencoded characters in credentials
  }
  const match = uri.match(/^mongodb\+srv:\/\/(?:[^@]+@)?([^/?#]+)/i)
  return match ? match[1].trim() : null
}

/**
 * Checks whether the given DNS server list consists only of loopback addresses.
 * @param {string[]} servers
 * @returns {boolean}
 */
export function isLoopbackDns(servers) {
  if (!Array.isArray(servers) || servers.length === 0) return true
  return servers.every((server) => {
    const s = String(server).trim().toLowerCase()
    return s === '127.0.0.1' || s === '::1' || s === 'localhost' || s.startsWith('127.')
  })
}

/**
 * Parses a comma- or space-separated list of DNS server IP addresses.
 * @param {string} raw
 * @returns {string[]}
 */
export function parseDnsServerList(raw) {
  if (!raw || typeof raw !== 'string') return []
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Diagnostic and resolution helper for MongoDB Atlas SRV connection strings.
 *
 * Problem on Windows:
 * Node.js uses c-ares for asynchronous DNS resolution (e.g. resolveSrv), which attempts
 * to discover Windows DNS servers via Win32 adapter APIs. When network interfaces use
 * IPv6 link-local gateways (e.g. fe80::1) or virtual adapters (VMware/WSL) without explicit
 * IPv4 DNS servers, c-ares fails to discover adapter DNS and falls back to ['127.0.0.1'].
 * Since no DNS daemon runs on 127.0.0.1:53, any SRV query immediately triggers:
 *   querySrv ECONNREFUSED _mongodb._tcp.<cluster>.mongodb.net
 *
 * This function:
 * 1. Inspects the URI to determine if an SRV lookup is required.
 * 2. Honors user-specified DNS_SERVERS from Server/.env or environment.
 * 3. Tests the default system DNS servers first.
 * 4. Only if the default servers are unviable (loopback or querySrv ECONNREFUSED),
 *    activates verified fallback resolvers (Cloudflare/Google/Gateway) with full diagnostic logging.
 *
 * @param {string} [mongoUri]
 * @param {object} [options]
 * @returns {Promise<{ resolved: boolean, skipped?: boolean, method?: string, servers?: string[], justification?: string, error?: Error }>}
 */
export async function ensureMongoDnsResolution(mongoUri = config.mongoUri, options = {}) {
  const srvHostname = extractSrvHostname(mongoUri)
  if (!srvHostname) {
    return { resolved: true, skipped: true, reason: 'Not a mongodb+srv:// URI' }
  }

  const srvRecord = `_mongodb._tcp.${srvHostname}`
  const initialServers = dns.getServers()
  const customConfigured = parseDnsServerList(options.configuredServers || config.dnsServers)

  // 1. If explicit DNS_SERVERS are configured in the environment, test and apply them first
  if (customConfigured.length > 0) {
    try {
      dns.setServers(customConfigured)
      const addresses = await dns.promises.resolveSrv(srvRecord)
      console.log(
        `[MongoDB DNS] Applied configured DNS servers [${customConfigured.join(', ')}] (verified ${addresses.length} SRV records for ${srvHostname}).`,
      )
      return { resolved: true, method: 'env_configured', servers: customConfigured }
    } catch (err) {
      console.warn(
        `[MongoDB DNS Warning] Configured DNS servers [${customConfigured.join(', ')}] failed to resolve ${srvRecord}: ${err.message}. Checking alternatives...`,
      )
      dns.setServers(initialServers)
    }
  }

  // 2. Test current system DNS servers if they are not loopback-only
  const isLoopbackOnly = isLoopbackDns(initialServers)
  let defaultError = null

  if (!isLoopbackOnly) {
    try {
      const addresses = await dns.promises.resolveSrv(srvRecord)
      return { resolved: true, method: 'system_default', servers: initialServers, recordsCount: addresses.length }
    } catch (err) {
      defaultError = err
    }
  }

  // 3. Document explicit justification for applying fallback resolvers
  const justification = isLoopbackOnly
    ? `Node.js c-ares DNS resolver initialized with loopback servers [${initialServers.join(', ')}] on Windows. No local DNS service is listening on port 53, causing querySrv to fail with ECONNREFUSED.`
    : `System DNS servers [${initialServers.join(', ')}] failed to resolve ${srvRecord}: ${defaultError?.code || defaultError?.message}.`

  console.warn(`[MongoDB DNS Diagnostic] ${justification} Testing verified fallback DNS servers...`)

  // 4. Candidate fallback resolvers
  // - Cloudflare (1.1.1.1, 1.0.0.1) & Google (8.8.8.8, 8.8.4.4): standard trusted public DNS with full SRV support
  // - Local router gateway (192.168.1.1): typical home/office router DNS
  const candidateLists = [
    ['1.1.1.1', '8.8.8.8'],
    ['8.8.8.8', '1.1.1.1'],
    ['192.168.1.1'],
  ]

  let lastError = defaultError

  for (const candidate of candidateLists) {
    try {
      dns.setServers(candidate)
      const addresses = await dns.promises.resolveSrv(srvRecord)
      console.log(
        `[MongoDB DNS Diagnostic] Fallback DNS resolution succeeded using [${candidate.join(', ')}] (${addresses.length} SRV records resolved for ${srvHostname}).`,
      )
      return {
        resolved: true,
        method: 'fallback_verified',
        servers: candidate,
        justification,
        recordsCount: addresses.length,
      }
    } catch (err) {
      lastError = err
    }
  }

  // 5. If all candidates failed, restore original servers and log structured error diagnostic
  dns.setServers(initialServers)
  const failureDiagnostic = {
    event: 'mongodb.dns.resolution_failed',
    hostname: srvHostname,
    srvRecord,
    initialServers,
    justification,
    errorMessage: lastError?.message || 'Unknown DNS resolution error',
    errorCode: lastError?.code,
    guidance: [
      'To resolve this on Windows, you can:',
      '1. Configure DNS_SERVERS=1.1.1.1,8.8.8.8 in Server/.env',
      '2. Or set IPv4 DNS servers on your active Windows Wi-Fi/Ethernet adapter to 8.8.8.8 or 1.1.1.1',
    ],
  }
  console.error(JSON.stringify(failureDiagnostic, null, 2))

  return {
    resolved: false,
    method: 'failed',
    servers: initialServers,
    justification,
    error: lastError,
  }
}

