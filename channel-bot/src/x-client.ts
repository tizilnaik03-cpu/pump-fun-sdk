/**
 * PumpFun Channel Bot — X/Twitter Profile Client
 *
 * Fetches X/Twitter profile data (follower counts) using Twitter API v2.
 * Requires TWITTER_BEARER_TOKEN env var. Degrades gracefully if unavailable.
 */

import { log } from './logger.js';

const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN ?? '';
const TWITTER_API = 'https://api.x.com/2';

// ============================================================================
// Types
// ============================================================================

export interface XProfile {
    /** X/Twitter username (without @) */
    username: string;
    /** Display name */
    name: string;
    /** Follower count */
    followers: number;
    /** Following count */
    following: number;
    /** Whether the account is verified */
    verified: boolean;
    /** Profile description/bio */
    description: string | null;
    /** Profile URL */
    url: string;
}

export type InfluencerTier = 'mega' | 'influencer' | 'notable' | null;

// ============================================================================
// Cache (10 min TTL, same pattern as github-client)
// ============================================================================

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

const profileCache = new Map<string, CacheEntry<XProfile | null>>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

function getCached(username: string): XProfile | null | undefined {
    const entry = profileCache.get(username.toLowerCase());
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
        profileCache.delete(username.toLowerCase());
        return undefined;
    }
    return entry.data;
}

function setCache(username: string, data: XProfile | null, ttl: number = CACHE_TTL): void {
    profileCache.set(username.toLowerCase(), { data, expiresAt: Date.now() + ttl });
    // Evict expired entries when cache grows too large
    if (profileCache.size > 300) {
        const now = Date.now();
        for (const [k, v] of profileCache) {
            if (now > v.expiresAt) profileCache.delete(k);
        }
    }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Fetch an X/Twitter profile by username.
 * Returns null if token is missing, user not found, or API error.
 */
export async function fetchXProfile(username: string): Promise<XProfile | null> {
    if (!TWITTER_BEARER_TOKEN) {
        return null;
    }

    const cached = getCached(username);
    if (cached !== undefined) return cached;

    try {
        const url = `${TWITTER_API}/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics,verified,description`;
        const resp = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${TWITTER_BEARER_TOKEN}`,
                'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(5000),
        });

        if (!resp.ok) {
            if (resp.status === 404) {
                setCache(username, null);
                return null;
            }
            if (resp.status === 429) {
                log.warn('X API rate limited for @%s', username);
                setCache(username, null, 30_000); // short cooldown to avoid hammering
                return null;
            }
            log.warn('X API error %d for @%s', resp.status, username);
            return null;
        }

        const body = (await resp.json()) as Record<string, unknown>;
        const data = body.data as Record<string, unknown> | undefined;
        if (!data) {
            setCache(username, null);
            return null;
        }

        const metrics = (data.public_metrics ?? {}) as Record<string, number>;
        const profile: XProfile = {
            username: String(data.username ?? username),
            name: String(data.name ?? ''),
            followers: Number(metrics.followers_count ?? 0),
            following: Number(metrics.following_count ?? 0),
            verified: Boolean(data.verified),
            description: data.description ? String(data.description) : null,
            url: `https://x.com/${encodeURIComponent(String(data.username ?? username))}`,
        };

        setCache(username, profile);
        log.info('Fetched X profile @%s — %d followers', profile.username, profile.followers);
        return profile;
    } catch (err) {
        log.error('X profile fetch failed for @%s: %s', username, err);
        return null;
    }
}

/**
 * Determine influencer tier from combined GitHub + X signals.
 *
 * - mega:       X >= 100K or GitHub >= 10K
 * - influencer: X >= 10K  or GitHub >= 1K
 * - notable:    X >= 1K   or GitHub >= 100
 * - null:       below thresholds or no data
 */
export function getInfluencerTier(
    githubFollowers: number,
    xFollowers: number | null,
): InfluencerTier {
    const xf = xFollowers ?? 0;
    if (xf >= 100_000 || githubFollowers >= 10_000) return 'mega';
    if (xf >= 10_000 || githubFollowers >= 1_000) return 'influencer';
    if (xf >= 1_000 || githubFollowers >= 100) return 'notable';
    return null;
}

/**
 * Format follower count with K/M suffix.
 */
export function formatFollowerCount(count: number): string {
    if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
    if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
    return String(count);
}

/**
 * Get display label for influencer tier.
 */
export function influencerLabel(tier: InfluencerTier): string {
    switch (tier) {
        case 'mega': return '🔥🔥 MEGA INFLUENCER';
        case 'influencer': return '🔥 Influencer';
        case 'notable': return '⭐ Notable';
        default: return '';
    }
}
